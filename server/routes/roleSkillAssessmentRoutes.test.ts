import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareerStrategy } from '../../shared/careerStrategy';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import type { CoachTurnInput } from '../domain/coach';
import { createCandidate, createStore, output } from '../data/sqliteTestHarness';
import type { CoachProviderResult } from '../providers/coachProvider';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { config } from '../appTestHarness';
import type { RouteDeps } from './deps';
import { registerRoleSkillAssessmentRoutes } from './roleSkillAssessmentRoutes';

const ROLE_TITLE = 'Head of Product';
const OBSERVED_AT = '2026-10-09T12:00:00.000Z';
const DIALOGUE_ANSWERS = [
  'Провела 12 интервью и выделила три устойчивых сценария для клиентов.',
  'Проверила unit-экономику сегмента и согласовала измеримые критерии решения.',
  'Сверила конверсию с контрольной группой до запуска на всю аудиторию.',
] as const;
const CASE_ANSWER =
  'Сначала проверила стоимость операций, затем сравнила конверсию с контрольной группой.';
const CURRENT_PATH = '/api/v1/candidate/role-skill-assessments/current';
const START_PATH = '/api/v1/candidate/role-skill-assessments/start';
const BASE_PATH = '/api/v1/candidate/role-skill-assessments';
const ORIGIN = config.allowedOrigins[0] ?? 'http://localhost:3000';

const TEST_STRATEGY: CareerStrategy = {
  current: {
    version: 2,
    role: {
      title: ROLE_TITLE,
      origin: 'model',
      reason: 'Руководство продуктовой командой и ответственностью за результат.',
      evidenceRefs: ['memory:role-fixture'],
      confirmation: { state: 'too-few', sampleSize: 3 },
    },
    constraints: { regions: ['ru'], note: null },
    reason: 'Проверка навыков для выбранной роли.',
    decidedAt: OBSERVED_AT,
    provenance: { namedBy: 'gemini:gemini-3.6-flash', language: 'ru', poolSize: 8 },
  },
  history: [],
};

const SUGGESTION_JSON = JSON.stringify({
  suggestions: Array.from({ length: 12 }, (_, index) => {
    const sourceAnswerIndex = index % DIALOGUE_ANSWERS.length;
    const sourceExcerpt = [
      'Провела 12 интервью',
      'Проверила unit-экономику',
      'Сверила конверсию с контрольной группой',
    ][sourceAnswerIndex]!;
    return {
      domain: 'skill',
      statement: `Подтверждённый факт роли ${index + 1}.`,
      sourceExcerpt,
      sourceAnswerIndex,
    };
  }),
});

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.close();
});

function matchedVacancies(count: number): MatchedVacancyItem[] {
  return Array.from({ length: count }, (_, index) => {
    const clusterId = `fixture-vacancy-${index}`;
    const cluster: MatchedVacancyItem['cluster'] = {
      id: clusterId,
      canonicalTitle: ROLE_TITLE,
      canonicalCompany: `Fixture employer ${index}`,
      canonicalLocation: 'Москва',
      isRemote: true,
      descriptionSummary: 'Требования к продуктовой стратегии, аналитике и результатам команды.',
      skills: [
        'Product discovery',
        'Unit economics',
        'SQL analytics',
        'A/B testing',
        'Stakeholder management',
      ],
      primaryUrl: `https://jobs.example.test/${clusterId}`,
      sources: [
        {
          sourceType: 'rss',
          sourceId: `fixture-source-${index}`,
          sourceName: 'Synthetic vacancy fixture',
          sourceUrl: `https://jobs.example.test/${clusterId}`,
          observedAt: OBSERVED_AT,
        },
      ],
      firstObservedAt: OBSERVED_AT,
      lastSeenAt: OBSERVED_AT,
      status: 'active',
      vacanciesCount: 1,
    };
    const explanation = {
      clusterId,
      roleMatch: 'target',
      levelMatch: 'unknown',
      matchingPoints: ['Product discovery'],
      missingPoints: [],
      summary: 'Synthetic requirement fixture for the selected role.',
      calculatedAt: OBSERVED_AT,
    } as unknown as MatchedVacancyItem['explanation'];
    return { cluster, explanation };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstSourceRefId(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = firstSourceRefId(item);
      if (id) return id;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (Array.isArray(value.sourceRefs)) {
    for (const source of value.sourceRefs) {
      if (isRecord(source) && typeof source.id === 'string') return source.id;
    }
  }
  for (const nested of Object.values(value)) {
    const id = firstSourceRefId(nested);
    if (id) return id;
  }
  return null;
}

function providerResult(message: string): CoachProviderResult {
  return {
    ...output,
    result: {
      ...output.result,
      message,
      memoryCandidates: [],
      actionProposals: [],
    },
  };
}

function createFakeProvider(options: { failFirstCall?: boolean } = {}) {
  let callCount = 0;
  const createTurn = vi.fn(async (input: CoachTurnInput) => {
    callCount += 1;
    if (options.failFirstCall && callCount === 1) throw new Error('synthetic provider outage');
    if (callCount === 1 || options.failFirstCall) return providerResult(SUGGESTION_JSON);

    const stageContextText = input.stageContext ?? '';
    if (stageContextText.includes('Explain the case condition')) {
      return providerResult('Кейс проверяет, как вы обосновываете решение данными.');
    }
    const stageContext = JSON.parse(stageContextText) as unknown;
    const sourceRefId = firstSourceRefId(stageContext);
    if (!sourceRefId) throw new Error('evaluation prompt omitted case source refs');
    return providerResult(
      JSON.stringify({
        grade: 'partial',
        criteria: [
          {
            criterionId: 'context',
            grade: 'confirmed',
            explanation: 'Ответ называет контекст решения.',
            candidateExcerpt: CASE_ANSWER,
            sourceRefIds: [sourceRefId],
          },
          {
            criterionId: 'actions',
            grade: 'confirmed',
            explanation: 'Ответ описывает сравнение двух показателей.',
            candidateExcerpt: CASE_ANSWER,
            sourceRefIds: [sourceRefId],
          },
          {
            criterionId: 'verification',
            grade: 'partial',
            explanation: 'Не указан численный результат проверки.',
            candidateExcerpt: CASE_ANSWER,
            sourceRefIds: [sourceRefId],
          },
        ],
      }),
    );
  });
  return { createTurn };
}

async function createRig(initialVacancyCount = 8, failFirstProviderCall = false) {
  const store = createStore();
  const candidate = createCandidate(store);
  const otherCandidate = createCandidate(store);
  store.saveCareerStrategy(candidate.id, TEST_STRATEGY);
  const getMatchedVacanciesAsync = vi.fn(async () => matchedVacancies(initialVacancyCount));
  const provider = createFakeProvider({ failFirstCall: failFirstProviderCall });
  const cookieToken = `test-cookie-session-${candidate.id}`;
  const cookieSessions = new Map([[cookieToken, candidate]]);
  const authService = {
    authenticate: vi.fn((token: string) => {
      const cookieCandidate = cookieSessions.get(token);
      const identity = cookieCandidate
        ? store.authenticate(cookieCandidate.accessToken)
        : store.authenticate(token);
      return identity
        ? { userId: identity.id, role: 'candidate' as const, candidate: identity }
        : null;
    }),
  };
  const deps = {
    config,
    authService,
    candidateStore: store,
    coachProvider: { createTurn: provider.createTurn },
    multiSourceEngine: { getMatchedVacanciesAsync },
  } as unknown as RouteDeps;
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerRoleSkillAssessmentRoutes(app, deps);
  apps.push(app);

  return {
    app,
    store,
    candidate,
    otherCandidate,
    cookieToken,
    provider,
    getMatchedVacanciesAsync,
  };
}

function headersFor(candidate: Awaited<ReturnType<typeof createCandidate>>) {
  return { authorization: `Bearer ${candidate.accessToken}`, origin: ORIGIN };
}

function mutationHeaders(rig: Awaited<ReturnType<typeof createRig>>, candidate = rig.candidate) {
  return headersFor(candidate);
}

function responseData(response: { json(): unknown }): unknown {
  const body = response.json();
  return isRecord(body) ? body.data : undefined;
}

function runFrom(response: { json(): unknown }): RoleSkillAssessmentRun {
  const data = responseData(response);
  if (isRecord(data)) {
    if (isRecord(data.run)) return data.run as unknown as RoleSkillAssessmentRun;
    if (isRecord(data.assessment)) return data.assessment as unknown as RoleSkillAssessmentRun;
  }
  if (isRecord(data)) return data as unknown as RoleSkillAssessmentRun;
  throw new Error('assessment response did not contain a run');
}

async function startRun(rig: Awaited<ReturnType<typeof createRig>>) {
  const response = await rig.app.inject({
    method: 'POST',
    url: START_PATH,
    headers: mutationHeaders(rig),
    payload: { consent: true },
  });
  expect(response.statusCode).toBe(200);
  return runFrom(response);
}

async function postDialogue(
  rig: Awaited<ReturnType<typeof createRig>>,
  run: RoleSkillAssessmentRun,
  answer: string,
  requestId = randomUUID(),
) {
  const payload = { expectedRevision: run.revision, requestId, answer };
  const response = await rig.app.inject({
    method: 'POST',
    url: `${BASE_PATH}/${run.id}/dialogue`,
    headers: mutationHeaders(rig),
    payload,
  });
  return { payload, response };
}

async function completeDialogue(
  rig: Awaited<ReturnType<typeof createRig>>,
  initialRun: RoleSkillAssessmentRun,
) {
  let run = initialRun;
  for (const answer of DIALOGUE_ANSWERS) {
    const { response } = await postDialogue(rig, run, answer);
    expect(response.statusCode).toBe(200);
    run = runFrom(response);
  }
  return run;
}

async function decideSuggestions(
  rig: Awaited<ReturnType<typeof createRig>>,
  run: RoleSkillAssessmentRun,
  acceptedIds: ReadonlySet<string>,
) {
  return rig.app.inject({
    method: 'POST',
    url: `${BASE_PATH}/${run.id}/suggestions`,
    headers: mutationHeaders(rig),
    payload: {
      expectedRevision: run.revision,
      requestId: randomUUID(),
      suggestions: run.suggestions.map((suggestion) => ({
        id: suggestion.id,
        accepted: acceptedIds.has(suggestion.id),
        statement: suggestion.statement,
      })),
    },
  });
}

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
