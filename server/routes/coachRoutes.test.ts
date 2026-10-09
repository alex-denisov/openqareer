import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../appTestHarness';
import { createCandidate, createStore, output } from '../data/sqliteTestHarness';
import type { CoachTurnInput } from '../domain/coach';
import type { RouteDeps } from './deps';
import { registerCoachRoutes } from './coachRoutes';
import { registerCandidateRoutes } from './candidateRoutes';
import { consultantProposalKey } from '../../shared/consultantProposalKey';

describe('Coach Stage Routes (B340)', () => {
  const closeHandlers: (() => Promise<unknown>)[] = [];

  afterEach(async () => {
    for (const close of closeHandlers.splice(0)) {
      await close();
    }
  });

  async function createTestServer(options: { failSummary?: boolean; captureLogs?: boolean } = {}) {
    const store = createStore();
    const candidate = createCandidate(store);
    let logOutput = '';
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += chunk.toString();
        callback();
      },
    });
    const app = Fastify(options.captureLogs ? { logger: { level: 'warn', stream: logStream } } : { logger: false });
    await app.register(cookie);
    await app.register(rateLimit, { global: false });

    let lastCreatedTurnInput: CoachTurnInput | null = null;
    const coachProvider = {
      createTurn: vi.fn(async (input: CoachTurnInput) => {
        lastCreatedTurnInput = input;
        if (options.failSummary && input.internalPurpose === 'consultant-summary') {
          throw new Error(`Provider failure for ${input.messages[0]?.content ?? 'empty message'}`);
        }
        return {
          ...output,
          result: {
            ...output.result,
            phase: input.phase,
            message: `Ответ для фазы ${input.phase}`,
            actionProposals: [
              {
                kind: 'resume.revise' as const,
                objective: 'Уточнить перечисление навыков в резюме.',
                evidenceRefs: ['memory:typescript'],
                acceptanceCriteria: ['Сохранены только указанные навыки.'],
                expectedSignal: 'Кандидат подтвердил формулировку.',
                measureAfter: '2026-10-10',
                risk: 'candidate_data_write' as const,
                resumeRevision: {
                  section: 'skills' as const,
                  experienceId: 'experience-1',
                  memoryId: null,
                  proposedText: 'TypeScript, React',
                },
              },
            ],
          },
        };
      }),
    };

    const multiSourceEngine = {
      getActiveCluster: vi.fn((id: string) => {
        if (id === 'vac-active') {
          return {
            id: 'vac-active',
            canonicalTitle: 'Senior Frontend Engineer',
            canonicalCompany: 'Tech Corp',
            canonicalLocation: 'Москва',
            skills: ['React', 'TypeScript', 'GraphQL'],
            status: 'active' as const,
          };
        }
        return undefined;
      }),
      getPublicCatalogCluster: vi.fn(),
      getVacancy: vi.fn(),
    };

    const authService = {
      authenticate: vi.fn((token: string) => {
        if (token === candidate.accessToken) {
          return {
            userId: 'user-1',
            role: 'candidate' as const,
            candidate: {
              id: candidate.id,
              dataClass: candidate.dataClass,
              locale: candidate.locale,
              createdAt: candidate.createdAt,
            },
          };
        }
        return null;
      }),
    };

    const deps = {
      config,
      authService,
      candidateStore: store,
      coachProvider,
      multiSourceEngine,
      searchVacancies: vi.fn(),
    } as unknown as RouteDeps;

    registerCoachRoutes(app, deps);
    registerCandidateRoutes(app, deps);

    closeHandlers.push(async () => {
      await app.close();
    });

    const headers = {
      authorization: `Bearer ${candidate.accessToken}`,
      origin: config.allowedOrigins[0],
    };

    return {
      app,
      store,
      candidate,
      headers,
      coachProvider,
      getLastInput: () => lastCreatedTurnInput,
      getLogOutput: () => logOutput,
    };
  }

  it('определяет фазу по stage без регулярок', async () => {
    const { app, headers, getLastInput } = await createTestServer();

    // Запрос содержит слово «роль», которое регулярка отнесла бы к 'role',
    // но явно передан stage: 'vacancies', что должно дать фазу 'market'.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Какая роль подходит для этой вакансии?',
        stage: 'vacancies',
      },
    });

    expect(response.statusCode).toBe(200);
    const input = getLastInput();
    expect(input?.phase).toBe('market');
  });

  it('старый клиент без stage использует выбор фазы по регуляркам', async () => {
    const { app, headers, getLastInput } = await createTestServer();

    // Без stage слово «роль» уходит в фазу 'role'
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Какая роль мне подходит?',
      },
    });

    expect(response.statusCode).toBe(200);
    const input = getLastInput();
    expect(input?.phase).toBe('role');
  });

  it('изолирует ленты сообщений по этапам', async () => {
    const { app, headers } = await createTestServer();

    // Сообщение этапа profile
    const profileResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Посмотри мой профиль',
        stage: 'profile',
      },
    });
    expect(profileResponse.statusCode).toBe(200);

    // Запрос ленты этапа vacancies не должен содержать сообщения из profile
    const vacanciesFeed = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me/messages?stage=vacancies',
      headers,
    });
    expect(vacanciesFeed.statusCode).toBe(200);
    const vacanciesMessages = vacanciesFeed.json().data;
    expect(vacanciesMessages).toHaveLength(0);

    // Запрос ленты этапа profile должен содержать сообщение
    const profileFeed = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me/messages?stage=profile',
      headers,
    });
    expect(profileFeed.statusCode).toBe(200);
    const profileMessages = profileFeed.json().data;
    expect(profileMessages.length).toBeGreaterThanOrEqual(1);
    expect(profileMessages.some((m: { content: string }) => m.content === 'Посмотри мой профиль')).toBe(true);
  });

  it('возвращает 404 при subject несуществующей вакансии', async () => {
    const { app, headers } = await createTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Что думаешь об этой вакансии?',
        stage: 'vacancies',
        subject: { kind: 'vacancy', id: 'non-existent-vacancy-id' },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('subject_not_found');
  });

  it('добавляет контекст вакансии в ввод модели при валидном subject', async () => {
    const { app, headers, getLastInput } = await createTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Расскажи об этой вакансии',
        stage: 'vacancies',
        subject: { kind: 'vacancy', id: 'vac-active' },
      },
    });

    expect(response.statusCode).toBe(200);
    const input = getLastInput();
    expect(input?.stageContext).toContain('Вакансия: Senior Frontend Engineer');
    expect(input?.stageContext).toContain('Компания: Tech Corp');
  });

  it('отклоняет предложение и не возвращает его повторно', async () => {
    const { app, headers, getLastInput, store, candidate } = await createTestServer();

    const proposal = {
      section: 'skills',
      resumeRevision: {
        proposedText: 'TypeScript, React',
      },
    };
    const propKey = consultantProposalKey(proposal);

    // Отклоняем предложение через маршрут
    const rejectResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/proposals/reject',
      headers,
      payload: {
        proposalKey: propKey,
        reason: 'Уже знаю эту технологию',
      },
    });
    expect(rejectResponse.statusCode).toBe(200);

    // Проверяем, что отказ сохранён в базе
    const rejections = store.getConsultantRejections(candidate.id);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].proposalKey).toBe(propKey);

    // Следующий ход должен содержать строку «Отклонено: skills — Уже знаю эту технологию» в rejectedProposals
    const nextTurn = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Что дальше?',
        stage: 'profile',
      },
    });
    expect(nextTurn.statusCode).toBe(200);
    const input = getLastInput();
    expect(input?.rejectedProposals).toBeDefined();
    expect(input?.rejectedProposals?.[0]).toContain('Отклонено: skills — Уже знаю эту технологию');

    // Сервер должен отфильтровать отклонённое предложение из результата
    const resultProposals = nextTurn.json().data.actionProposals;
    expect(resultProposals).toHaveLength(0);
  });

  it('верифицирует квиз и возвращает статус и предложение для профиля (B376)', async () => {
    const { app, headers } = await createTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/skill-quiz/verify',
      headers,
      payload: {
        quizId: 'typescript',
        skillName: 'TypeScript',
        answers: {
          'ts-1': 1,
          'ts-2': 1,
          'ts-3': 1,
          'ts-4': 1,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.result.passed).toBe(true);
    expect(body.result.status).toBe('подтверждён');
    expect(body.fact.status).toBe('подтверждён');
    expect(body.fact.source).toContain('hh.ru');
    expect(body.proposal.kind).toBe('resume.revise');
    expect(body.proposal.resumeRevision.section).toBe('skills');
  });

  it('summarizes a closed session once and exposes candidate-scoped read-only history (B436)', async () => {
    const { app, headers, candidate, store, coachProvider } = await createTestServer();
    const firstKey = randomUUID();
    const secondKey = randomUUID();
    const thirdKey = randomUUID();
    const firstMessageId = randomUUID();
    const secondMessageId = randomUUID();
    const thirdMessageId = randomUUID();
    const sendTurn = (key: string, messageId: string, stage: string, content: string) => app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': key },
      payload: { messageId, content, stage },
    });

    expect((await sendTurn(firstKey, firstMessageId, 'profile', 'Я внедрил Kafka для платежей.')).statusCode).toBe(200);
    expect((await sendTurn(secondKey, secondMessageId, 'career', 'Какой результат стоит выделить?')).statusCode).toBe(200);
    const summaryCalls = coachProvider.createTurn.mock.calls.filter(([input]) => input.internalPurpose === 'consultant-summary');
    expect(summaryCalls).toHaveLength(1);
    expect(coachProvider.createTurn).toHaveBeenCalledTimes(3);

    const list = await app.inject({ method: 'GET', url: '/api/v1/candidate/consultant-history', headers });
    expect(list.statusCode).toBe(200);
    const conversationId = list.json().data[0].id as string;
    const detail = await app.inject({ method: 'GET', url: `/api/v1/candidate/consultant-history/${conversationId}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.messages).toHaveLength(2);
    expect(store.exportCandidate(candidate.id).consultantConversations).toHaveLength(1);

    expect((await sendTurn(thirdKey, thirdMessageId, 'career', 'Продолжим с учётом прежней беседы.')).statusCode).toBe(200);
    const thirdInput = coachProvider.createTurn.mock.calls[3]?.[0];
    expect(thirdInput?.knowledgeContext?.consultantHistory?.summaries).toEqual(
      expect.arrayContaining([expect.objectContaining({ summary: 'Ответ для фазы evidence' })]),
    );
    expect(coachProvider.createTurn).toHaveBeenCalledTimes(4);

    const append = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/consultant-history/${conversationId}/messages`,
      headers,
      payload: { content: 'Нельзя продолжить закрытую беседу.' },
    });
    expect(append.statusCode).toBe(409);
    expect(append.json().error.code).toBe('conversation_read_only');

    expect((await sendTurn(thirdKey, thirdMessageId, 'career', 'Продолжим с учётом прежней беседы.')).statusCode).toBe(200);
    expect(coachProvider.createTurn).toHaveBeenCalledTimes(4);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/candidate/consultant-history/${conversationId}`,
      headers,
    });
    expect(removed.statusCode).toBe(204);
    expect(store.listConsultantConversations(candidate.id).items).toEqual([]);
  });

  it('does not write message content to logs when summary generation fails (B436)', async () => {
    const { app, headers, getLogOutput } = await createTestServer({ failSummary: true, captureLogs: true });
    const privateMessage = 'PRIVATE_B436_MESSAGE_should_never_appear_in_logs';
    const sendTurn = (stage: string, content: string) => app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: { messageId: randomUUID(), content, stage },
    });

    expect((await sendTurn('profile', privateMessage)).statusCode).toBe(200);
    expect((await sendTurn('career', 'Новый вопрос после закрытой беседы.')).statusCode).toBe(200);
    expect(getLogOutput()).not.toContain(privateMessage);
    expect(getLogOutput()).not.toContain('Provider failure');
  });
});
