import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import {
  BASE_PATH,
  CASE_ANSWER,
  OBSERVED_AT,
  completeDialogue,
  createRig,
  decideSuggestions,
  headersFor,
  mutationHeaders,
  responseData,
  runFrom,
  startRun,
} from './roleSkillAssessmentRouteTestRig';

type Rig = Awaited<ReturnType<typeof createRig>>;
type Run = ReturnType<typeof runFrom>;

async function casesRun(rig: Rig): Promise<Run> {
  const run = await completeDialogue(rig, await startRun(rig));
  return runFrom(await decideSuggestions(rig, run, new Set()));
}

async function answerFirst(rig: Rig, run: Run): Promise<Run> {
  const answered = await rig.app.inject({
    method: 'POST',
    url: `${BASE_PATH}/${run.id}/cases/${run.cases[0]!.assessmentCase.id}/answer`,
    headers: mutationHeaders(rig),
    payload: { expectedRevision: run.revision, requestId: randomUUID(), answer: CASE_ANSWER },
  });
  expect(answered.statusCode).toBe(200);
  return runFrom(answered);
}

function keepOut(rig: Rig, run: Run, caseId: string, requestId = randomUUID()) {
  return rig.app.inject({
    method: 'POST',
    url: `${BASE_PATH}/${run.id}/cases/${caseId}/keep-out`,
    headers: mutationHeaders(rig),
    payload: { expectedRevision: run.revision, requestId },
  });
}

describe('B734 case result without a profile write', () => {
  it('marks an evaluated case as kept out of the profile and replays idempotently', async () => {
    const rig = await createRig();
    const run = await answerFirst(rig, await casesRun(rig));
    const caseId = run.cases[0]!.assessmentCase.id;
    const requestId = randomUUID();

    const kept = await keepOut(rig, run, caseId, requestId);
    expect(kept.statusCode).toBe(200);
    const updated = runFrom(kept);
    expect(updated.cases[0]?.keptOutOfProfile).toBe(true);
    expect(updated.revision).toBe(run.revision + 1);
    expect(updated.cases[0]?.evaluation?.grade).toBe('partial');
    expect(rig.store.getSnapshot(rig.candidate.id).memory).toHaveLength(0);

    const replay = await keepOut(rig, run, caseId, requestId);
    expect(replay.statusCode).toBe(200);
    expect(runFrom(replay).revision).toBe(updated.revision);
  });

  it('refuses a case that has no result yet', async () => {
    const rig = await createRig();
    const run = await casesRun(rig);
    const response = await keepOut(rig, run, run.cases[0]!.assessmentCase.id);
    expect(response.statusCode).toBe(409);
  });

  it('a new answer to the case clears the earlier choice', async () => {
    const rig = await createRig();
    const answered = await answerFirst(rig, await casesRun(rig));
    const kept = runFrom(await keepOut(rig, answered, answered.cases[0]!.assessmentCase.id));
    const again = await answerFirst(rig, kept);
    expect(again.cases[0]?.keptOutOfProfile).toBeUndefined();
  });

  it('checked roles leave out a confirmed skill the candidate kept out of the profile', async () => {
    const rig = await createRig();
    const run = await casesRun(rig);
    const [first, second, ...rest] = run.skills;
    const keptCaseId = first.caseId;
    rig.store.roleSkillAssessments.create(rig.candidate.id, {
      ...run,
      id: randomUUID(),
      revision: 1,
      status: 'complete',
      completedAt: OBSERVED_AT,
      cases: run.cases.map((record) =>
        record.assessmentCase.id === keptCaseId ? { ...record, keptOutOfProfile: true } : record,
      ),
      skills: [
        { ...first, grade: 'confirmed' },
        { ...second, grade: 'confirmed' },
        ...rest.map((skill: typeof first) => ({ ...skill, grade: 'not_confirmed' as const })),
      ],
    });
    const response = await rig.app.inject({
      method: 'GET',
      url: `${BASE_PATH}/checked-roles`,
      headers: headersFor(rig.candidate),
    });
    expect(responseData(response)).toEqual([
      expect.objectContaining({ confirmedSkills: [second.name] }),
    ]);
  });
});

describe('B734 case wording', () => {
  it('names the skill in Russian from the skills dictionary, not the raw vacancy label', async () => {
    const rig = await createRig();
    const run = await startRun(rig);
    const names = run.skills.map((skill) => skill.name);
    expect(names).toContain('Unit-экономика');
    expect(names).toContain('Управление стейкхолдерами');
    expect(names).not.toContain('Stakeholder management');
  });

  it('asks the model to address the candidate as «вы» in every explanation', async () => {
    const rig = await createRig();
    await answerFirst(rig, await casesRun(rig));
    const contexts = rig.provider.createTurn.mock.calls
      .map(([input]) => (input as CoachTurnInput).stageContext ?? '')
      .filter((text) => text.includes('Evaluate the candidate answer'));
    expect(contexts).toHaveLength(1);
    const context = JSON.parse(contexts[0]!) as { instructions: string[] };
    expect(context.instructions.join(' ')).toMatch(/second person.*«вы»/u);
  });
});
