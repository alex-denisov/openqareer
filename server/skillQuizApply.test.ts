import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { candidateAuthorization, createApp, stores } from './appTestHarness';

const origin = 'http://localhost:3000';

async function setup(skills: NonNullable<typeof EMPTY_RESUME_DRAFT.skills>) {
  const app = await createApp();
  const authorization = candidateAuthorization(app);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/candidate/me',
    headers: { authorization },
  });
  const candidateId = me.json().data.candidate.id as string;
  const store = stores[stores.length - 1]!;
  store.saveResumeDraft(candidateId, { ...EMPTY_RESUME_DRAFT, skills }, []);
  const readSkills = () => store.getSnapshot(candidateId).resume?.draft.skills ?? [];
  const apply = (auth = authorization, skillName = 'TypeScript') =>
    app.inject({
      method: 'POST',
      url: '/api/v1/candidate/skill-quiz/apply',
      headers: { authorization: auth, origin, 'idempotency-key': randomUUID() },
      payload: { quizId: 'typescript', skillName, answers: {} },
    });
  const revert = (commandId: string, auth = authorization) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/revert`,
      headers: { authorization: auth, origin },
    });
  return { app, store, candidateId, authorization, readSkills, apply, revert };
}

describe('B376 skill quiz result goes through a revertable career command', () => {
  it('returns a commandId and restores the previous skill state on revert', async () => {
    const t = await setup([
      { id: 'sk-1', name: 'TypeScript', level: 'Продвинутый', status: 'заявлен' },
    ]);
    const applied = await t.apply();
    expect(applied.statusCode).toBe(201);
    const { commandId, fact } = applied.json().data;
    expect(commandId).toEqual(expect.any(String));
    expect(t.readSkills()[0]).toMatchObject({
      id: 'sk-1',
      level: 'Продвинутый',
      status: fact.status,
      source: fact.source,
      verifiedAt: fact.date,
    });
    const resume = await t.app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization: t.authorization },
    });
    expect(resume.json().data.draft.skills[0]).toMatchObject({
      status: fact.status,
      source: fact.source,
      verifiedAt: fact.date,
    });

    const reverted = await t.revert(commandId);
    expect(reverted.statusCode).toBe(200);
    const skill = t.readSkills()[0]!;
    expect(skill).toMatchObject({ id: 'sk-1', name: 'TypeScript', status: 'заявлен' });
    expect(skill.source).toBeUndefined();
    expect(skill.verifiedAt).toBeUndefined();
  });

  it('removes a skill that the quiz added when reverted', async () => {
    const t = await setup([]);
    const applied = await t.apply();
    expect(t.readSkills()).toHaveLength(1);
    expect((await t.revert(applied.json().data.commandId)).statusCode).toBe(200);
    expect(t.readSkills()).toHaveLength(0);
  });

  it('answers a repeated revert with a predictable 409', async () => {
    const t = await setup([{ id: 'sk-1', name: 'TypeScript' }]);
    const { commandId } = (await t.apply()).json().data;
    expect((await t.revert(commandId)).statusCode).toBe(200);
    const again = await t.revert(commandId);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('profile_revision_already_reverted');
  });

  it("does not let another candidate revert the first candidate's command", async () => {
    const t = await setup([{ id: 'sk-1', name: 'TypeScript', status: 'заявлен' }]);
    const { commandId } = (await t.apply()).json().data;
    const other = t.store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const stolen = await t.revert(commandId, `Bearer ${other.accessToken}`);
    expect(stolen.statusCode).toBe(404);
    expect(t.readSkills()[0]?.source).toBeDefined();
  });

  it('refuses to revert over a later candidate edit and rejects an unknown quiz', async () => {
    const t = await setup([{ id: 'sk-1', name: 'TypeScript' }]);
    const { commandId } = (await t.apply()).json().data;
    t.store.saveResumeDraft(t.candidateId, EMPTY_RESUME_DRAFT, []);
    expect((await t.revert(commandId)).statusCode).toBe(409);
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v1/candidate/skill-quiz/apply',
      headers: { authorization: t.authorization, origin, 'idempotency-key': randomUUID() },
      payload: { quizId: 'nope', skillName: 'X', answers: {} },
    });
    expect(bad.statusCode).toBe(404);
  });
});
