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
import type { BulkCompletion } from '../domain/measuredBulkClient';

/** Provider calls that answer the candidate; the background analysis (28.10) is not one. */
function replyCalls(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls.filter((call) => (call[2] as { split?: string } | undefined)?.split !== 'analysis');
}

describe('Coach Stage Routes (B340)', () => {
  const closeHandlers: (() => Promise<unknown>)[] = [];

  afterEach(async () => {
    for (const close of closeHandlers.splice(0)) {
      await close();
    }
  });

  async function createTestServer(
    options: { failSummary?: boolean; captureLogs?: boolean; searchVacancies?: RouteDeps['searchVacancies']; bulk?: BulkCompletion } = {},
  ) {
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
      searchVacancies: options.searchVacancies ?? vi.fn(),
      bulkLlmRuntime: options.bulk ? { client: options.bulk } : undefined,
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

  it('lists the candidate facts of a long answer into the profile, even when the reply fails (26.10)', async () => {
    const bulk: BulkCompletion = {
      complete: vi.fn(async () => ({
        content: JSON.stringify({
          facts: [
            {
              kind: 'fact',
              domain: 'responsibility',
              statement: 'Точно было 254 человека в направлении',
            },
          ],
        }),
        model: 'deepseek/deepseek-v4-flash',
        provider: 'DeepSeek',
        usage: { cost: 0.0003, promptTokens: 800, cachedTokens: 0, completionTokens: 120 },
      })),
    };
    const { app, headers, coachProvider } = await createTestServer({ bulk });
    const answer =
      'Ну, 256 человек – это примерная цифра, но точно было 254, то, что я помню. '.repeat(4);
    const turn = (key: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/coach/turn',
        headers: { ...headers, 'idempotency-key': key },
        payload: { messageId: randomUUID(), content: answer, phase: 'evidence' },
      });

    expect((await turn(randomUUID())).statusCode).toBe(200);
    const memory = await app.inject({ method: 'GET', url: '/api/v1/candidate/me/memory', headers });
    const proposed = (
      memory.json().data as Array<{ statement: string; status: string; confidence: string }>
    ).filter((item) => item.status === 'proposed' && item.statement.includes('254'));
    expect(proposed).toHaveLength(1);
    expect(proposed[0].confidence).toBe('candidate-reported');

    coachProvider.createTurn.mockRejectedValueOnce(new Error('provider down'));
    vi.mocked(bulk.complete).mockResolvedValueOnce({
      content: JSON.stringify({
        facts: [{ kind: 'preference', domain: 'preference', statement: 'Готов к гибриду' }],
      }),
      model: 'deepseek/deepseek-v4-flash',
      provider: 'DeepSeek',
      usage: { cost: 0.0003, promptTokens: 800, cachedTokens: 0, completionTokens: 60 },
    });
    await turn(randomUUID());
    const after = await app.inject({ method: 'GET', url: '/api/v1/candidate/me/memory', headers });
    expect(JSON.stringify(after.json())).toContain('Готов к гибриду');
  });

  it('B357 resolves the owned adaptation plan on the server and continues one diary thread', async () => {
    const { app, headers, store, candidate, getLastInput, coachProvider } = await createTestServer();
    const workplace = store.careerDiaryRepo.createWorkplace(candidate.id, { company: 'Тестовая компания', title: 'Инженер', startDate: '2026-10-01' });
    const plan = { id: 'plan-test', workplaceId: workplace.id, startDate: workplace.startDate, createdAt: workplace.createdAt, status: 'active', closedAt: null, tasks: [] };
    store.careerDiaryRepo.updateWorkplace(candidate.id, workplace.id, { company: workplace.company, planning: { adaptationPlan: plan } } as Parameters<typeof store.careerDiaryRepo.updateWorkplace>[2]);
    const subject = { kind: 'adaptation', id: workplace.id, planId: plan.id, adaptationStage: 'days_1_30' };
    const tooLong = await app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { messageId: randomUUID(), content: 'а'.repeat(7001), stage: 'diary', subject } });
    expect(tooLong.statusCode).toBe(400);
    for (const content of ['Как уточнить ожидания?', 'Пока не знаю']) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { messageId: randomUUID(), content, stage: 'diary', subject } });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.adaptationContext.workplaceId).toBe(workplace.id);
    }
    expect(getLastInput()?.stageContext).toContain('Тестовая компания');
    expect(getLastInput()?.stageContext).toContain('не является подтверждённым достижением');
    expect(getLastInput()?.messages.some(message => message.content.includes('Как уточнить ожидания?'))).toBe(true);
    const history = await app.inject({ method: 'GET', url: '/api/v1/candidate/me/messages?stage=diary', headers });
    expect(history.statusCode).toBe(200);
    expect(JSON.stringify(history.json())).toContain('Пока не знаю');
    coachProvider.createTurn.mockImplementationOnce(async input => ({ ...output, result: { ...output.result, phase: input.phase, actionProposals: [], message: 'а'.repeat(6001) } }));
    const oversized = await app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { messageId: randomUUID(), content: 'Проверить ответ', stage: 'diary', subject } });
    expect(oversized.statusCode).toBe(502);
    const missing = await app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { messageId: randomUUID(), content: 'Обсудим', stage: 'diary', subject: { ...subject, id: randomUUID() } } });
    expect(missing.statusCode).toBe(404);
  });

  it('B357 confirms only a stored suggestion, retries once, rejects stale and archived plans', async () => {
    const { app, headers, store, candidate, coachProvider } = await createTestServer();
    const workplace = store.careerDiaryRepo.createWorkplace(candidate.id, { company: 'Тест', title: 'Инженер', startDate: '2026-10-01' });
    const plan = { id: 'plan-confirm', workplaceId: workplace.id, startDate: workplace.startDate, createdAt: workplace.createdAt, status: 'active', closedAt: null, tasks: [] };
    store.careerDiaryRepo.updateWorkplace(candidate.id, workplace.id, { company: workplace.company, planning: { adaptationPlan: plan } } as Parameters<typeof store.careerDiaryRepo.updateWorkplace>[2]);
    const otherCandidate = createCandidate(store);
    const key = randomUUID();
    coachProvider.createTurn.mockImplementationOnce(async input => ({ ...output, result: { ...output.result, phase: input.phase, actionProposals: [], adaptationTask: { title: 'Уточнить ожидания', description: 'Согласовать критерий результата.', dueDate: null } } }));
    const generated = await app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': key }, payload: { messageId: randomUUID(), content: 'Предложи задачу', stage: 'diary', subject: { kind: 'adaptation', id: workplace.id, planId: plan.id, adaptationStage: 'days_1_30' } } });
    expect(generated.statusCode, generated.body).toBe(200);
    const foreignHeaders = { ...headers, authorization: `Bearer ${otherCandidate.accessToken}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/coach/adaptation-proposals/' + key, headers: foreignHeaders })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + key, headers: foreignHeaders, payload: { title: 'Чужая задача', description: '', dueDate: '2026-11-01' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + key, headers: { origin: 'https://untrusted.example' }, payload: { title: 'Подмена', description: '', dueDate: '2026-11-01' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + key, headers, payload: { title: 'Подмена', description: '', dueDate: '2026-11-01', result: { completed: true } } })).statusCode).toBe(400);
    const confirm = () => app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + key, headers, payload: { title: 'Согласовать ожидания', description: 'Обсудить критерий с руководителем.', dueDate: '2026-11-01' } });
    expect((await confirm()).statusCode).toBe(200);
    const replay = await confirm();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.planning.adaptationPlan.tasks).toHaveLength(1);
    expect(replay.json().data.planning.adaptationPlan.tasks[0].completed).toBe(false);
    const state = await app.inject({ method: 'GET', url: '/api/v1/coach/adaptation-proposals/' + key, headers });
    expect(state.json().data.status).toBe('applied');
    const secondKey = randomUUID();
    coachProvider.createTurn.mockImplementationOnce(async input => ({ ...output, result: { ...output.result, phase: input.phase, actionProposals: [], adaptationTask: { title: 'Вторая задача', description: 'Уточнить результат.', dueDate: null } } }));
    await app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': secondKey }, payload: { messageId: randomUUID(), content: 'Ещё задача', stage: 'diary', subject: { kind: 'adaptation', id: workplace.id, planId: plan.id, adaptationStage: 'days_1_30' } } });
    store.careerDiaryRepo.updateWorkplace(candidate.id, workplace.id, { title: 'Новая роль' });
    const stale = await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + secondKey, headers, payload: { title: 'Вторая задача', description: '', dueDate: '2026-11-01' } });
    expect(stale.statusCode).toBe(409);
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/coach/proposals/reject', headers, payload: { proposalKey: 'adaptation:' + secondKey } });
    expect(rejected.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/coach/adaptation-proposals/' + secondKey, headers })).json().data.status).toBe('dismissed');
    store.careerDiaryRepo.updateWorkplace(candidate.id, workplace.id, { endDate: '2026-10-20' });
    expect((await confirm()).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + randomUUID(), headers, payload: { title: 'Fake', description: '', dueDate: '2026-11-01' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + key, payload: { title: 'Fake' } })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('B357 replays the same question after its workplace label changes without a second model call', async () => {
    const { app, headers, store, candidate, coachProvider } = await createTestServer();
    const place = store.careerDiaryRepo.createWorkplace(candidate.id, { company: 'Тест', title: 'Инженер', startDate: '2026-10-01' });
    const plan = { id: 'retry-plan', workplaceId: place.id, startDate: place.startDate, createdAt: place.createdAt, status: 'active', closedAt: null, tasks: [] };
    store.careerDiaryRepo.updateWorkplace(candidate.id, place.id, { company: place.company, planning: { adaptationPlan: plan } } as Parameters<typeof store.careerDiaryRepo.updateWorkplace>[2]);
    const key = randomUUID();
    const payload = { messageId: randomUUID(), content: 'Как уточнить ожидания?', stage: 'diary', subject: { kind: 'adaptation', id: place.id, planId: plan.id, adaptationStage: 'prep' } };
    const request = () => app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': key }, payload });
    const original = await request();
    expect(original.statusCode).toBe(200);
    store.careerDiaryRepo.updateWorkplace(candidate.id, place.id, { title: 'Новая должность' });
    const replay = await request();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toEqual(original.json().data);
    const contextState = await app.inject({ method: 'GET', url: '/api/v1/coach/adaptation-context/' + key, headers });
    expect(contextState.json().data.stale).toBe(true);
    expect(replyCalls(coachProvider.createTurn)).toHaveLength(1);
  });

  it('B357 edits an existing task only after confirmation, keeps completion, and exports its receipt', async () => {
    const { app, headers, store, candidate, coachProvider } = await createTestServer();
    const place = store.careerDiaryRepo.createWorkplace(candidate.id, { company: 'Тест', title: 'Инженер', startDate: '2026-10-01' });
    const task = { id: 'task-existing', title: 'Сверить ожидания', description: 'Исходный критерий', dueDate: '2026-11-01', stage: 'prep', category: 'alignment', completed: true, source: 'template' };
    const plan = { id: 'edit-plan', workplaceId: place.id, startDate: place.startDate, createdAt: place.createdAt, status: 'active', closedAt: null, tasks: [task] };
    store.careerDiaryRepo.updateWorkplace(candidate.id, place.id, { company: place.company, planning: { adaptationPlan: plan } } as Parameters<typeof store.careerDiaryRepo.updateWorkplace>[2]);
    const key = randomUUID();
    const suggestion = { title: 'Уточнить критерий готовности', description: 'Согласовать наблюдаемый результат', dueDate: '2026-11-05', targetTaskId: task.id };
    coachProvider.createTurn.mockImplementationOnce(async input => ({ ...output, result: { ...output.result, phase: input.phase, actionProposals: [], adaptationTask: suggestion } }));
    await app.inject({ method: 'POST', url: '/api/v1/coach/turn', headers: { ...headers, 'idempotency-key': key }, payload: { messageId: randomUUID(), content: 'Уточни существующую задачу', stage: 'diary', subject: { kind: 'adaptation', id: place.id, planId: plan.id, adaptationStage: 'prep' } } });
    const before = await app.inject({ method: 'GET', url: '/api/v1/coach/adaptation-proposals/' + key, headers });
    expect(before.json().data.target.title).toBe('Сверить ожидания');
    const edits = { title: suggestion.title, description: suggestion.description, dueDate: suggestion.dueDate };
    expect((await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + key, headers, payload: { ...edits, targetTaskId: 'another-task' } })).statusCode).toBe(400);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const confirmed = await app.inject({ method: 'POST', url: '/api/v1/coach/adaptation-proposals/' + key, headers, payload: edits });
      expect(confirmed.statusCode).toBe(200);
      const tasks = confirmed.json().data.planning.adaptationPlan.tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ id: task.id, title: suggestion.title, completed: true });
    }
    const exported = await app.inject({ method: 'GET', url: '/api/v1/candidate/export', headers });
    expect(exported.json().data.adaptationApplications).toHaveLength(1);
    expect(exported.json().data.adaptationApplications[0].targetTaskId).toBe(task.id);
    expect(store.deleteCandidate(candidate.id)).toBe(true);
    expect(store.careerDiaryRepo.adaptationApplications.exportApplications(candidate.id)).toEqual([]);
  });

  it('B528 removes invented candidate quick answers before delivery and replay', async () => {
    const { app, headers, coachProvider } = await createTestServer();
    coachProvider.createTurn.mockImplementationOnce(async (input) => ({
      ...output,
      result: {
        ...output.result,
        phase: input.phase,
        message: 'Обсудим следующий шаг.',
        quickReplies: ['Я создал проект Atlas', 'I increased revenue by 90%', 'Расскажите подробнее'],
        actionProposals: [],
      },
    }));
    const key = randomUUID();
    const payload = { messageId: randomUUID(), content: 'Как ответить?', stage: 'interviews' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/coach/turn',
        headers: { ...headers, 'idempotency-key': key }, payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.quickReplies).toEqual(['Расскажите подробнее']);
      expect(response.json().data.message).toBe('Обсудим следующий шаг.');
    }
    expect(replyCalls(coachProvider.createTurn)).toHaveLength(1);
  });

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
    const notifications = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications',
      headers,
    });
    expect(notifications.json().data.items.map((item: { kind: string }) => item.kind)).toContain('consultant_edits');
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

  it('«Обсудить» вакансию не ходит за живой выборкой рынка (блок C R5)', async () => {
    const searchVacancies = vi.fn(async () => {
      throw new Error('hh.ru is unreachable from the host');
    });
    const { app, headers, getLastInput } = await createTestServer({ searchVacancies });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: {
        messageId: randomUUID(),
        content: 'Почему эта вакансия подходит?',
        stage: 'vacancies',
        subject: { kind: 'vacancy', id: 'vac-active' },
        marketQuery: 'VP of Engineering',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(searchVacancies).not.toHaveBeenCalled();
    expect(getLastInput()?.marketObservations).toEqual([]);
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
    expect(replyCalls(coachProvider.createTurn)).toHaveLength(3);
    // 28.10: the candidate gets the reply first; the closed conversation is summarized after it.
    expect(replyCalls(coachProvider.createTurn).map(([input]) => (input as { internalPurpose?: string }).internalPurpose ?? 'turn')).toEqual([
      'turn',
      'turn',
      'consultant-summary',
    ]);

    const list = await app.inject({ method: 'GET', url: '/api/v1/candidate/consultant-history', headers });
    expect(list.statusCode).toBe(200);
    const conversationId = list.json().data[0].id as string;
    const detail = await app.inject({ method: 'GET', url: `/api/v1/candidate/consultant-history/${conversationId}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.messages).toHaveLength(2);
    expect(store.exportCandidate(candidate.id).consultantConversations).toHaveLength(1);

    expect((await sendTurn(thirdKey, thirdMessageId, 'career', 'Продолжим с учётом прежней беседы.')).statusCode).toBe(200);
    const thirdInput = replyCalls(coachProvider.createTurn)[3]?.[0] as CoachTurnInput | undefined;
    expect(thirdInput?.knowledgeContext?.consultantHistory?.summaries).toEqual(
      expect.arrayContaining([expect.objectContaining({ summary: 'Ответ для фазы evidence' })]),
    );
    expect(replyCalls(coachProvider.createTurn)).toHaveLength(4);

    const append = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/consultant-history/${conversationId}/messages`,
      headers,
      payload: { content: 'Нельзя продолжить закрытую беседу.' },
    });
    expect(append.statusCode).toBe(409);
    expect(append.json().error.code).toBe('conversation_read_only');

    expect((await sendTurn(thirdKey, thirdMessageId, 'career', 'Продолжим с учётом прежней беседы.')).statusCode).toBe(200);
    expect(replyCalls(coachProvider.createTurn)).toHaveLength(4);
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
