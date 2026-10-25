import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RouteDeps } from './deps';
import {
  ROLE_TITLE,
  OBSERVED_AT,
  DIALOGUE_ANSWERS,
  CASE_ANSWER,
  CURRENT_PATH,
  START_PATH,
  BASE_PATH,
  ORIGIN,
  createRig,
  headersFor,
  mutationHeaders,
  responseData,
  runFrom,
  startRun,
  postDialogue,
  completeDialogue,
  decideSuggestions,
} from './roleSkillAssessmentRouteTestRig';

describe('B461 role skill assessment routes', () => {
  it('requires candidate auth and CSRF, then enforces the 7/8 fresh-vacancy boundary', async () => {
    const rig = await createRig(7);
    const unauthorized = await rig.app.inject({
      method: 'POST',
      url: START_PATH,
      headers: { origin: ORIGIN },
      payload: { consent: true },
    });
    expect(unauthorized.statusCode).toBe(401);

    const csrfRejected = await rig.app.inject({
      method: 'POST',
      url: START_PATH,
      headers: {
        cookie: `openqareer_session=${rig.cookieToken}`,
        origin: 'https://attacker.example.test',
      },
      payload: { consent: true },
    });
    expect(csrfRejected.statusCode).toBe(403);

    const consentRejected = await rig.app.inject({
      method: 'POST',
      url: START_PATH,
      headers: headersFor(rig.candidate),
      payload: { consent: false },
    });
    expect(consentRejected.statusCode).toBeGreaterThanOrEqual(400);
    expect(rig.provider.createTurn).not.toHaveBeenCalled();

    const tooFew = await rig.app.inject({
      method: 'POST',
      url: START_PATH,
      headers: headersFor(rig.candidate),
      payload: { consent: true },
    });
    expect(tooFew.statusCode).toBe(200);
    expect(responseData(tooFew)).toMatchObject({
      state: 'too_few_vacancies',
      sampleSize: 7,
      threshold: 8,
    });
    expect(rig.store.roleSkillAssessments.list(rig.candidate.id)).toHaveLength(0);

    const readyRig = await createRig(8);
    const run = await startRun(readyRig);
    expect(run.sampleSize).toBe(8);
    expect(run.status).toBe('dialogue');
    expect(readyRig.getMatchedVacanciesAsync).toHaveBeenCalled();
    expect(readyRig.provider.createTurn).not.toHaveBeenCalled();
  });

  it('waits for all three answers, replays idempotently, and applies then rolls back selected suggestions', async () => {
    const rig = await createRig();
    const initialMemories = rig.store.getSnapshot(rig.candidate.id).memory;
    const initialRun = await startRun(rig);

    const first = await postDialogue(rig, initialRun, DIALOGUE_ANSWERS[0]);
    expect(first.response.statusCode).toBe(200);
    let run = runFrom(first.response);
    expect(rig.provider.createTurn).not.toHaveBeenCalled();

    const second = await postDialogue(rig, run, DIALOGUE_ANSWERS[1]);
    expect(second.response.statusCode).toBe(200);
    run = runFrom(second.response);
    expect(rig.provider.createTurn).not.toHaveBeenCalled();

    const third = await postDialogue(rig, run, DIALOGUE_ANSWERS[2]);
    expect(third.response.statusCode).toBe(200);
    run = runFrom(third.response);
    expect(run.status).toBe('suggestions');
    expect(run.suggestions).toHaveLength(12);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(1);
    expect(rig.store.getSnapshot(rig.candidate.id).memory).toEqual(initialMemories);

    const replay = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/dialogue`,
      headers: mutationHeaders(rig),
      payload: third.payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(1);

    const changedReplay = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/dialogue`,
      headers: mutationHeaders(rig),
      payload: { ...third.payload, answer: 'Изменённый текст того же запроса.' },
    });
    expect(changedReplay.statusCode).toBe(409);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(1);

    const selected = run.suggestions[3]!;
    const accepted = await decideSuggestions(rig, run, new Set([selected.id]));
    expect(accepted.statusCode).toBe(200);
    expect(runFrom(accepted).status).toBe('cases');
    const memories = rig.store.getSnapshot(rig.candidate.id).memory;
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      domain: selected.domain,
      statement: selected.statement,
      status: 'confirmed',
    });
    run = runFrom(accepted);
    expect(run.profileChange?.memoryIds).toHaveLength(1);
    const rollbackPayload = { expectedRevision: run.revision, requestId: randomUUID() };
    const rollback = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/suggestions/rollback`,
      headers: mutationHeaders(rig),
      payload: rollbackPayload,
    });
    expect(rollback.statusCode).toBe(200);
    const rolledBack = runFrom(rollback);
    expect(rolledBack.profileChange?.memoryIds).toEqual([]);
    expect(rolledBack.profileChange?.revertedAt).toBeTruthy();
    expect(rig.store.getSnapshot(rig.candidate.id).memory).toEqual(initialMemories);
  });

  it('stores model grading against the exact answer and case refs while skip stays unverified', async () => {
    const rig = await createRig();
    let run = await startRun(rig);
    run = await completeDialogue(rig, run);

    const casesReady = await decideSuggestions(rig, run, new Set());
    expect(casesReady.statusCode).toBe(200);
    run = runFrom(casesReady);
    expect(run.status).toBe('cases');
    expect(rig.store.getSnapshot(rig.candidate.id).memory).toHaveLength(0);

    const firstCase = run.cases[0]!;
    const answered = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/cases/${firstCase.assessmentCase.id}/answer`,
      headers: mutationHeaders(rig),
      payload: {
        expectedRevision: run.revision,
        requestId: randomUUID(),
        answer: CASE_ANSWER,
      },
    });
    expect(answered.statusCode).toBe(200);
    run = runFrom(answered);
    const evaluated = run.cases[0]!;
    expect(evaluated.answer).toBe(CASE_ANSWER);
    expect(evaluated.evaluation?.candidateAnswer).toBe(CASE_ANSWER);
    expect(evaluated.evaluation?.grade).toBe('partial');
    for (const criterion of evaluated.evaluation?.criteria ?? []) {
      expect(CASE_ANSWER.includes(criterion.candidateExcerpt)).toBe(true);
      expect(criterion.sourceRefIds.length).toBeGreaterThan(0);
      expect(
        criterion.sourceRefIds.every((id) =>
          firstCase.assessmentCase.sourceRefs.some((source) => source.id === id),
        ),
      ).toBe(true);
    }
    expect(evaluated.evaluation?.criteria.map((criterion) => criterion.criterionId)).toEqual([
      'context',
      'actions',
      'verification',
    ]);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(2);

    const discussed = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/cases/${firstCase.assessmentCase.id}/discuss`,
      headers: mutationHeaders(rig),
      payload: {
        expectedRevision: run.revision,
        requestId: randomUUID(),
        question: 'Что именно проверяет это условие?',
      },
    });
    expect(discussed.statusCode).toBe(200);
    run = runFrom(discussed);
    expect(run.cases[0]?.discussion.at(-1)).toMatchObject({
      question: 'Что именно проверяет это условие?',
      answer: 'Кейс проверяет, как вы обосновываете решение данными.',
    });
    expect(run.cases[0]?.evaluation?.candidateAnswer).toBe(CASE_ANSWER);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(3);

    const appealed = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/cases/${firstCase.assessmentCase.id}/appeal`,
      headers: mutationHeaders(rig),
      payload: {
        expectedRevision: run.revision,
        requestId: randomUUID(),
        reason: 'Поясните, как учтён исходный контекст решения.',
      },
    });
    expect(appealed.statusCode).toBe(200);
    run = runFrom(appealed);
    expect(run.cases[0]?.answer).toBe(CASE_ANSWER);
    expect(run.cases[0]?.evaluationHistory).toHaveLength(1);
    expect(run.cases[0]?.evaluation?.candidateAnswer).toBe(CASE_ANSWER);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(4);

    const nextCase = run.cases[1]!;
    const skipped = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/cases/${nextCase.assessmentCase.id}/skip`,
      headers: mutationHeaders(rig),
      payload: { expectedRevision: run.revision, requestId: randomUUID() },
    });
    expect(skipped.statusCode).toBe(200);
    run = runFrom(skipped);
    expect(run.cases[1]?.status).toBe('skipped');
    expect(run.cases[1]?.evaluation).toBeNull();
    expect(run.skills.find((skill) => skill.id === nextCase.assessmentCase.skillId)?.grade).toBe(
      'not_confirmed',
    );
    expect(rig.store.getSnapshot(rig.candidate.id).memory).toHaveLength(0);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(4);
  });

  it('restores an autosaved draft for the current case without another model call', async () => {
    const rig = await createRig();
    let run = await startRun(rig);
    run = await completeDialogue(rig, run);
    const casesReady = await decideSuggestions(rig, run, new Set());
    expect(casesReady.statusCode).toBe(200);
    run = runFrom(casesReady);
    expect(run.status).toBe('cases');

    const providerCallsBeforeDraft = rig.provider.createTurn.mock.calls.length;
    const draft = 'Пока проверила только первые два показателя';
    const saved = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/cases/${run.cases[0]!.assessmentCase.id}/draft`,
      headers: mutationHeaders(rig),
      payload: { expectedRevision: run.revision, requestId: randomUUID(), draft },
    });
    expect(saved.statusCode).toBe(200);
    expect(runFrom(saved).cases[0]?.answer).toBe(draft);

    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    expect(current.statusCode).toBe(200);
    const restored = runFrom(current);
    expect(restored.id).toBe(run.id);
    expect(restored.cases[restored.currentCaseIndex]?.answer).toBe(draft);
    expect(restored.cases[0]?.status).toBe('pending');
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(providerCallsBeforeDraft);
  });

  it('keeps assessment run ids scoped to the candidate who created them', async () => {
    const rig = await createRig();
    const run = await startRun(rig);
    const otherCurrent = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.otherCandidate),
    });
    expect(otherCurrent.statusCode).toBe(200);
    expect(responseData(otherCurrent)).toMatchObject({ state: 'role_not_selected' });

    const foreignRetry = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/retry`,
      headers: headersFor(rig.otherCandidate),
      payload: { expectedRevision: run.revision, requestId: randomUUID() },
    });
    expect(foreignRetry.statusCode).toBe(404);
    expect(rig.provider.createTurn).not.toHaveBeenCalled();
  });

  it('persists provider failure as recoverable state and retries suggestion generation', async () => {
    const rig = await createRig(8, true);
    let run = await startRun(rig);
    for (const answer of DIALOGUE_ANSWERS.slice(0, 2)) {
      const response = await postDialogue(rig, run, answer);
      expect(response.response.statusCode).toBe(200);
      run = runFrom(response.response);
    }
    expect(rig.provider.createTurn).not.toHaveBeenCalled();

    const failed = await postDialogue(rig, run, DIALOGUE_ANSWERS[2]);
    expect(failed.response.statusCode).toBeGreaterThanOrEqual(500);
    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    run = runFrom(current);
    expect(run.status).toBe('model_error');
    expect(run.modelError?.action).toBe('suggestions');
    expect(rig.store.getSnapshot(rig.candidate.id).memory).toHaveLength(0);

    const retry = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/retry`,
      headers: mutationHeaders(rig),
      payload: { expectedRevision: run.revision, requestId: randomUUID() },
    });
    expect(retry.statusCode).toBe(200);
    const recovered = runFrom(retry);
    expect(recovered.status).toBe('suggestions');
    expect(recovered.suggestions).toHaveLength(12);
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(2);
    expect(rig.store.getSnapshot(rig.candidate.id).memory).toHaveLength(0);
  });
});

describe('B445 skill check for the role pressed on «Карьера»', () => {
  const OTHER_ROLE = 'Director of Engineering';

  it('starts and reads the run for the requested role without touching the strategy', async () => {
    const rig = await createRig(8);
    const started = await rig.app.inject({
      method: 'POST',
      url: START_PATH,
      headers: mutationHeaders(rig),
      payload: { consent: true, role: OTHER_ROLE },
    });
    expect(started.statusCode).toBe(200);
    expect(runFrom(started).roleTitle).toBe(OTHER_ROLE);
    expect(rig.store.getCareerStrategy(rig.candidate.id)?.current.role.title).toBe(ROLE_TITLE);

    const current = await rig.app.inject({
      method: 'GET',
      url: `${CURRENT_PATH}?role=${encodeURIComponent(OTHER_ROLE)}`,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(current)).toMatchObject({ state: 'run', run: { roleTitle: OTHER_ROLE } });

    const strategyCurrent = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(strategyCurrent)).toMatchObject({ state: 'ready', roleTitle: ROLE_TITLE });
  });

  it('lists roles whose check is complete so «Карьера» can mark them checked', async () => {
    const rig = await createRig(8);
    const started = await rig.app.inject({
      method: 'POST',
      url: START_PATH,
      headers: mutationHeaders(rig),
      payload: { consent: true, role: OTHER_ROLE },
    });
    const run = runFrom(started);
    const before = await rig.app.inject({
      method: 'GET',
      url: `${BASE_PATH}/checked-roles`,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(before)).toEqual([]);

    rig.store.roleSkillAssessments.create(rig.candidate.id, {
      ...run,
      id: randomUUID(),
      status: 'complete',
      completedAt: OBSERVED_AT,
    });
    const after = await rig.app.inject({
      method: 'GET',
      url: `${BASE_PATH}/checked-roles`,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(after)).toEqual([{ roleTitle: OTHER_ROLE, completedAt: OBSERVED_AT }]);
  });
});

describe('B509 skills from vacancy text when clusters carry none', () => {
  const SKILLS = [
    'Product discovery',
    'Unit economics',
    'SQL analytics',
    'A/B testing',
    'Roadmapping',
  ];
  const DESCRIPTION = `Requirements:\n${SKILLS.map((skill) => `- ${skill}`).join('\n')}`;

  function mechanics(cached: boolean) {
    const enqueue = vi.fn(() => ({ state: 'queued' as const }));
    const runtime = {
      requirements: {
        getLatestOrLegacy: vi.fn(() =>
          cached ? { extractorVersion: 'old', status: 'no_requirements', requirements: [] } : null,
        ),
        enqueue,
      },
    };
    return { runtime, enqueue };
  }

  function engine(description: string) {
    return {
      getActiveCluster: (id: string) => ({
        id,
        canonicalTitle: ROLE_TITLE,
        descriptionSummary: description,
      }),
      getVacancy: () => undefined,
    };
  }

  it('builds the check from requirement labels and queues the role vacancies for the model', async () => {
    const { runtime, enqueue } = mechanics(false);
    const rig = await createRig(8, false, {
      withClusterSkills: false,
      engine: engine(DESCRIPTION),
      extraDeps: { vacancyMechanics: runtime } as unknown as Partial<RouteDeps>,
    });
    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(current)).toMatchObject({ state: 'ready', roleTitle: ROLE_TITLE });
    expect(enqueue).toHaveBeenCalledTimes(8);
    expect(enqueue).toHaveBeenCalledWith(
      { vacancyId: 'fixture-vacancy-0', description: DESCRIPTION },
      { titleStrategyPriority: expect.any(Number) },
    );
  });

  it('says requirements are being collected while extraction is queued', async () => {
    const { runtime } = mechanics(false);
    const rig = await createRig(8, false, {
      withClusterSkills: false,
      engine: engine('Работа в продуктовой команде.'),
      extraDeps: { vacancyMechanics: runtime } as unknown as Partial<RouteDeps>,
    });
    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(current)).toMatchObject({
      state: 'insufficient_requirements',
      collecting: true,
    });
  });

  it('says insufficient, not collecting, once every vacancy has been extracted', async () => {
    const { runtime } = mechanics(true);
    const rig = await createRig(8, false, {
      withClusterSkills: false,
      engine: engine('Работа в продуктовой команде.'),
      extraDeps: { vacancyMechanics: runtime } as unknown as Partial<RouteDeps>,
    });
    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(current)).toMatchObject({
      state: 'insufficient_requirements',
      collecting: false,
    });
  });
});
