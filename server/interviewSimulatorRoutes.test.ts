import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachProvider, CoachProviderResult } from './providers/coachProvider';
import { buildApp } from './app';
import { config, noSessions } from './appTestHarness';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';

const URL = '/api/v1/candidate/interview-sessions';
const ORIGIN = { origin: 'http://localhost:3000' };
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const stores: SqliteCandidateStore[] = [];

function providerResult(message: string): CoachProviderResult {
  return {
    provider: 'openai',
    model: 'fake-interviewer',
    responseId: 'fake-interview-response',
    usage: { inputTokens: 10, outputTokens: 12, totalTokens: 22 },
    result: {
      message,
      phase: 'interview',
      memoryCandidates: [],
      nextQuestion: null,
      completeness: { known: [], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [],
    },
  };
}

async function setup(
  coachProvider: CoachProvider = { createTurn: async () => providerResult('Уточните личный вклад.') },
  tier: 'free' | 'pro' | 'executive' | 'enterprise' = 'pro',
) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const owner = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const fact = candidateStore.addManualExperienceFact(owner.id, 'fact-release', 'Цикл релиза стал короче.');
  candidateStore.starStoriesRepo.create(
    owner.id,
    'story-release',
    {
      title: 'Сокращение цикла релиза',
      fields: {
        situation: 'Релизы выходили раз в две недели.',
        task: 'Сократить цикл без потери качества.',
        action: 'Автоматизировал тесты и выкладку.',
        result: 'Цикл сократился с 14 до 3 дней.',
      },
      sourceFactIds: [fact.id],
    },
    '2026-10-11T08:00:00.000Z',
  );
  const authService = {
    ...noSessions,
    authenticate: (token: string) => {
      const account = token === 'owner-session'
        ? { userId: 'owner-user', candidate: owner }
        : token === 'other-session'
          ? { userId: 'other-user', candidate: other }
          : null;
      return account
        ? {
            ...account,
            username: account.userId,
            email: null,
            displayName: null,
            role: 'candidate' as const,
            isTest: true,
            emailVerified: true,
          }
        : null;
    },
    getUser: (userId: string) => ({
      candidateId: userId === 'owner-user' ? owner.id : other.id,
      subscriptionTier: tier,
      subscriptionStatus: 'active',
      subscriptionExpiresAt: null,
    }),
  };
  const app = await buildApp({
    config,
    coachProvider,
    candidateStore,
    authService: authService as unknown as typeof noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return {
    app,
    ownerId: owner.id,
    ownerAuth: 'Bearer owner-session',
    otherAuth: 'Bearer other-session',
    candidateStore,
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

describe('candidate interview simulator routes', () => {
  it('requires a paid interview tier before starting a session', async () => {
    const { app, ownerAuth, candidateStore, ownerId } = await setup(undefined, 'free');
    const response = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { mode: 'text', roleTitle: 'Руководитель инженерной команды' },
    });

    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('paywall_required');
    expect(candidateStore.interviewSimulatorRepo.getCurrent(ownerId)).toBeNull();
  });

  it('starts from candidate STAR evidence, evaluates an answer, and resumes at the same question', async () => {
    const createTurn = vi.fn<CoachProvider['createTurn']>(async () => providerResult('Добавьте, как измерили результат.'));
    const feedbackProvider: CoachProvider = { createTurn };
    const { app, ownerAuth, otherAuth, candidateStore, ownerId } = await setup(feedbackProvider);
    const started = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: {
        mode: 'text',
        roleTitle: 'Руководитель инженерной команды',
        questionTypes: ['behavioral', 'system_design'],
      },
    });
    const session = started.json().data.session;
    const answered = await app.inject({
      method: 'POST',
      url: `${URL}/${session.id}/answers`,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: {
        expectedVersion: 1,
        questionId: session.questions[0].id,
        answer: 'В проекте команда выпускала релизы раз в две недели. Задачей было сократить цикл без потери качества. Я настроил автотесты и автоматизировал деплой. Результат: цикл сократился с 14 до 3 дней.',
        elapsedSeconds: 90,
      },
    });
    const paused = await app.inject({
      method: 'PATCH',
      url: `${URL}/${session.id}`,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { expectedVersion: 2, action: 'interrupt' },
    });
    const resumed = await app.inject({
      method: 'PATCH',
      url: `${URL}/${session.id}`,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { expectedVersion: 3, action: 'resume' },
    });
    const foreign = await app.inject({
      method: 'GET',
      url: `${URL}/${session.id}`,
      headers: { authorization: otherAuth },
    });
    const exported = candidateStore.exportCandidate(ownerId).interviewSession;

    expect(started.statusCode).toBe(201);
    expect(session.questions).toHaveLength(5);
    expect(session.questions[0].storyId).toBe('story-release');
    expect(answered.statusCode).toBe(200);
    expect(answered.json().data.session.questions[0].answer.evaluation.points).toBe(8);
    expect(answered.json().data.session.questions[0].answer.evaluation.feedback).toContain('измерили результат');
    expect(paused.json().data.session.status).toBe('interrupted');
    expect(resumed.json().data.session.currentQuestionIndex).toBe(0);
    expect(foreign.statusCode).toBe(404);
    expect(exported?.questions[0].answer?.text).toContain('14 до 3 дней');
    expect(createTurn).toHaveBeenCalledOnce();
    expect(createTurn.mock.calls[0]?.[0].phase).toBe('interview');
    expect(createTurn.mock.calls[0]?.[0].stageContext).toContain('mock_interview_feedback');
  });

  it('returns the honest empty-story state and does not invent source facts', async () => {
    const { app, otherAuth } = await setup();
    const started = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: otherAuth, ...ORIGIN },
      payload: { mode: 'voice', roleTitle: 'Инженер данных', questionTypes: ['behavioral'] },
    });

    expect(started.statusCode).toBe(201);
    expect(started.json().data.session.questions[0].storyId).toBeNull();
    expect(started.json().data.session.questions[0].sourceFactIds).toEqual([]);
    expect(started.json().data.session.mode).toBe('voice');
  });
});
