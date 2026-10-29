import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { parseGeneratedQuestions } from './domain/generatedSkillQuiz';
import type { SkillQuizModel } from './providers/skillQuizModel';
import { candidateAuthorization, createApp, stores, successProvider } from './appTestHarness';

const origin = 'http://localhost:3000';

const QUESTIONS = parseGeneratedQuestions({
  questions: Array.from({ length: 8 }, (_, index) => ({
    question: `Что выберете в ситуации ${index}?`,
    options: ['Первое', 'Второе', 'Третье', 'Четвёртое'],
    correctOptionIndex: 2,
    explanation: 'Так принято в практике.',
  })),
})!;

const rightAnswers = (count: number) =>
  Object.fromEntries(QUESTIONS.map((question, index) => [question.id, index < count ? 2 : 0]));

async function setup(skills: NonNullable<typeof EMPTY_RESUME_DRAFT.skills>) {
  const generate = vi.fn<SkillQuizModel['generate']>(async () => QUESTIONS);
  const app = await createApp(successProvider, undefined, undefined, {
    skillQuizModel: { generate },
  });
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
  const post = (url: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url,
      headers: { authorization, origin, 'idempotency-key': randomUUID() },
      payload: payload as Record<string, unknown>,
    });
  const start = (skillName = 'Excel', level = 'middle') =>
    post('/api/v1/candidate/skill-quiz/generate', { skillName, level });
  const submit = (attemptId: string, answers: Record<string, number>) =>
    post(`/api/v1/candidate/skill-quiz/attempts/${attemptId}/submit`, { answers });
  const accept = (attemptId: string) =>
    post(`/api/v1/candidate/skill-quiz/attempts/${attemptId}/apply`, {});
  const confirmations = () =>
    app.inject({
      method: 'GET',
      url: '/api/v1/candidate/skill-confirmations',
      headers: { authorization },
    });
  return { app, store, candidateId, generate, readSkills, start, submit, accept, confirmations };
}

describe('quiz built for a profile skill (block A, package 3)', () => {
  it('sends questions without the right answers and asks the model by skill and level', async () => {
    const t = await setup([{ id: 'sk-1', name: 'Excel' }]);

    const started = await t.start();

    expect(started.statusCode).toBe(201);
    const data = started.json().data;
    expect(data).toMatchObject({ skillName: 'Excel', level: 'middle', passingScorePercent: 80 });
    expect(data.questions).toHaveLength(8);
    expect(JSON.stringify(data)).not.toMatch(/correctOptionIndex|explanation/);
    expect(t.generate).toHaveBeenCalledWith({ skill: 'Excel', level: 'middle' });
  });

  it('confirms the skill after the threshold with the honest source', async () => {
    const t = await setup([{ id: 'sk-1', name: 'Excel', status: 'заявлен' }]);
    const attemptId = (await t.start()).json().data.attemptId as string;

    const submitted = await t.submit(attemptId, rightAnswers(7));
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().data.result).toMatchObject({ scorePercent: 88, passed: true });
    expect(submitted.json().data.result.review[0]).toMatchObject({ correctOptionIndex: 2 });

    const applied = await t.accept(attemptId);
    expect(applied.statusCode).toBe(201);
    expect(t.readSkills()[0]).toMatchObject({
      id: 'sk-1',
      name: 'Excel',
      status: 'подтверждён',
      source: 'квиз openqareer',
    });
  });

  it('takes an attempt once: a second submit cannot rescore it', async () => {
    const t = await setup([{ id: 'sk-1', name: 'Excel' }]);
    const attemptId = (await t.start()).json().data.attemptId as string;
    await t.submit(attemptId, rightAnswers(0));

    const again = await t.submit(attemptId, rightAnswers(8));

    expect(again.statusCode).toBe(409);
  });

  it('writes a failed attempt but never downgrades a confirmed skill', async () => {
    const t = await setup([
      { id: 'sk-1', name: 'Excel', status: 'подтверждён', source: 'квиз openqareer' },
    ]);
    const attemptId = (await t.start()).json().data.attemptId as string;
    await t.submit(attemptId, rightAnswers(2));

    const applied = await t.accept(attemptId);

    expect(applied.statusCode).toBe(409);
    expect(t.readSkills()[0]?.status).toBe('подтверждён');
  });

  it('allows two attempts per skill a day', async () => {
    const t = await setup([{ id: 'sk-1', name: 'Excel' }]);
    await t.start();
    await t.start();

    const third = await t.start();

    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('skill_quiz_attempts_exhausted');
  });

  it('builds no quiz for a skill outside the profile or a management skill', async () => {
    const t = await setup([{ id: 'sk-1', name: 'Executive Leadership' }]);

    expect((await t.start('Docker')).statusCode).toBe(404);
    const management = await t.start('Executive Leadership');
    expect(management.statusCode).toBe(422);
    expect(management.json().error.code).toBe('skill_quiz_not_checkable');
    expect(t.generate).not.toHaveBeenCalled();
  });

  it('lists every profile skill with its quiz path and conversation facts', async () => {
    const t = await setup([
      { id: 'sk-1', name: 'Excel' },
      { id: 'sk-2', name: 'Executive Leadership' },
    ]);

    const response = await t.confirmations();

    expect(response.statusCode).toBe(200);
    expect(response.json().data.skills).toEqual([
      expect.objectContaining({
        name: 'Excel',
        quizCheckable: true,
        attemptsLeftToday: 2,
        lastAttempt: null,
        conversation: { name: 'Excel', state: 'not_checked', facts: [] },
      }),
      expect.objectContaining({ name: 'Executive Leadership', quizCheckable: false }),
    ]);
  });
});
