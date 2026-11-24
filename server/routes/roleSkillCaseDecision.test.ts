import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../appTestHarness';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import {
  BASE_PATH,
  CASE_ANSWER,
  completeDialogue,
  createRig,
  decideSuggestions,
  ORIGIN,
  runFrom,
  startRun,
} from './roleSkillAssessmentRouteTestRig';

/** B734: навык «Подтверждено кейсом» только после «Верно» на итоге кейса. */
async function answeredRun(usernames: string[]) {
  const rig = await createRig(8, false, {
    extraDeps: { config: { ...config, cabinetB640Usernames: usernames } },
  });
  const original = rig.deps.authService.authenticate;
  rig.deps.authService.authenticate = vi.fn((token: string | undefined) => {
    const principal = original(token as string);
    return principal ? { ...principal, username: 'flagged.test', email: null } : null;
  }) as typeof original;
  const headers = { cookie: `openqareer_session=${rig.cookieToken}`, origin: ORIGIN };
  let run = await completeDialogue(rig, await startRun(rig));
  run = runFrom(await decideSuggestions(rig, run, new Set()));
  const caseId = run.cases[0]!.assessmentCase.id;
  const answer = async (current: RoleSkillAssessmentRun) =>
    runFrom(
      await rig.app.inject({
        method: 'POST',
        url: `${BASE_PATH}/${run.id}/cases/${caseId}/answer`,
        headers,
        payload: {
          expectedRevision: current.revision,
          requestId: randomUUID(),
          answer: CASE_ANSWER,
        },
      }),
    );
  run = await answer(run);
  const decide = (current: RoleSkillAssessmentRun, accepted: boolean) =>
    rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${run.id}/cases/${caseId}/decision`,
      headers,
      payload: { expectedRevision: current.revision, requestId: randomUUID(), accepted },
    });
  const skillId = run.cases[0]!.assessmentCase.skillId;
  const grade = (current: RoleSkillAssessmentRun) =>
    current.skills.find((skill) => skill.id === skillId)?.grade;
  return { run, decide, grade, answer };
}

describe('B734: решение по итогу кейса', () => {
  it('до «Верно» навык не меняется, после — получает оценку', async () => {
    const { run, decide, grade } = await answeredRun(['flagged.test']);
    expect(run.cases[0]!.decision).toBe('pending');
    expect(grade(run)).toBe('not_confirmed');
    const accepted = await decide(run, true);
    expect(accepted.statusCode).toBe(200);
    const next = runFrom(accepted);
    expect(next.cases[0]!.decision).toBe('accepted');
    expect(grade(next)).toBe('partial');
    expect((await decide(next, false)).statusCode).toBe(409);
  });

  it('«Пропустить» оставляет навык как был, решение можно изменить на «Верно»', async () => {
    const { run, decide, grade } = await answeredRun(['flagged.test']);
    const declined = runFrom(await decide(run, false));
    expect(declined.cases[0]!.decision).toBe('declined');
    expect(grade(declined)).toBe('not_confirmed');
    expect(grade(runFrom(await decide(declined, true)))).toBe('partial');
  });

  it('новый ответ снова ждёт решения, устаревшая ревизия — 409', async () => {
    const { run, decide, answer } = await answeredRun(['flagged.test']);
    const accepted = runFrom(await decide(run, true));
    const again = await answer(accepted);
    expect(again.cases[0]!.decision).toBe('pending');
    expect((await decide(accepted, true)).statusCode).toBe(409);
  });

  it('без флага B640 — как раньше: оценка сразу, адреса решения нет', async () => {
    const { run, decide, grade } = await answeredRun([]);
    expect(run.cases[0]!.decision).toBeUndefined();
    expect(grade(run)).toBe('partial');
    expect((await decide(run, true)).statusCode).toBe(404);
  });
});
