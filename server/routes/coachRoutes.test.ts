import { randomUUID } from 'node:crypto';
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

  async function createTestServer() {
    const store = createStore();
    const candidate = createCandidate(store);
    const app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(rateLimit, { global: false });

    let lastCreatedTurnInput: CoachTurnInput | null = null;
    const coachProvider = {
      createTurn: vi.fn(async (input: CoachTurnInput) => {
        lastCreatedTurnInput = input;
        return {
          ...output,
          result: {
            ...output.result,
            phase: input.phase,
            message: `Ответ для фазы ${input.phase}`,
            actionProposals: [
              {
                id: 'prop-1',
                kind: 'resume.revise' as const,
                title: 'Уточнить навыки',
                description: 'Добавить React',
                section: 'skills',
                evidenceRefs: [],
                resumeRevision: {
                  section: 'skills' as const,
                  targetText: 'TypeScript',
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
});
