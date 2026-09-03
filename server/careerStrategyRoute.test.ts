import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import type { NamedRole } from '../shared/roleProposals';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

const named: NamedRole[] = [
  {
    title: 'Head of Product',
    reason: 'вёл продукты девять лет',
    evidenceRefs: ['memory:1'],
  },
];

async function createStrategyApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  // Без подтверждённого профиля роль называть не по чему.
  candidateStore.saveResumeDraft(
    candidate.id,
    { ...EMPTY_RESUME_DRAFT, targetRole: 'Продакт-менеджер' },
    [],
  );
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
    roleNamer: {
      async nameRoles() {
        return { roles: named, stage: 'gemini:gemini-3.6-flash' };
      },
    },
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

const ORIGIN = { origin: 'http://localhost:3000' };

describe('career strategy route', () => {
  it('не отдаёт и не принимает стратегию без сессии кандидата', async () => {
    const { app } = await createStrategyApp();

    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/strategy' })).statusCode).toBe(
      401,
    );
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/strategy',
      headers: ORIGIN,
      payload: { title: 'Head of Product' },
    });
    expect(post.statusCode).toBe(401);
  });

  it('до выбора стратегии нет, и это не ошибка', async () => {
    const { app, authorization } = await createStrategyApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/strategy',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeNull();
  });

  it('выбор названной моделью роли сохраняет её с провенансом и снимком пула', async () => {
    const { app, authorization } = await createStrategyApp();

    const chosen = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/strategy',
      headers: { authorization, ...ORIGIN },
      payload: { title: 'Head of Product' },
    });

    expect(chosen.statusCode).toBe(200);
    expect(chosen.json().data.current).toMatchObject({
      version: 1,
      reason: 'Первый выбор роли',
      role: {
        title: 'Head of Product',
        origin: 'model',
        reason: 'вёл продукты девять лет',
        evidenceRefs: ['memory:1'],
      },
      provenance: { namedBy: 'gemini:gemini-3.6-flash', language: expect.any(String) },
    });
    expect(chosen.json().data.current.provenance.poolSize).toEqual(expect.any(Number));

    // Стратегия переживает запрос: её читает следующий вход.
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/strategy',
      headers: { authorization },
    });
    expect(read.json().data.current.role.title).toBe('Head of Product');
  });

  it('роль, названную самим кандидатом, принимает и честно помечает', async () => {
    const { app, authorization } = await createStrategyApp();

    const chosen = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/strategy',
      headers: { authorization, ...ORIGIN },
      payload: { title: 'Директор по развитию' },
    });

    expect(chosen.statusCode).toBe(200);
    // Роль вне предложенных не отклоняется: кандидат вправе назвать свою.
    expect(chosen.json().data.current.role).toMatchObject({
      title: 'Директор по развитию',
      origin: 'candidate',
      reason: null,
    });
    expect(chosen.json().data.current.provenance.namedBy).toBeNull();
  });

  it('смена роли без причины отклоняется, с причиной — создаёт версию 2', async () => {
    const { app, authorization } = await createStrategyApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/strategy',
      headers: { authorization, ...ORIGIN },
      payload: { title: 'Head of Product' },
    });

    const silent = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/strategy',
      headers: { authorization, ...ORIGIN },
      payload: { title: 'Директор по развитию' },
    });
    expect(silent.statusCode).toBe(400);
    expect(silent.json().error.code).toBe('strategy_reason_required');

    const explained = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/strategy',
      headers: { authorization, ...ORIGIN },
      payload: { title: 'Директор по развитию', reason: 'откликов много, разговоров нет' },
    });
    expect(explained.statusCode).toBe(200);
    expect(explained.json().data.current).toMatchObject({
      version: 2,
      reason: 'откликов много, разговоров нет',
    });
    expect(explained.json().data.history[0].role.title).toBe('Head of Product');
  });

  it('чужая страница стратегию не меняет', async () => {
    const { app } = await createStrategyApp();

    // Cookie-сессию браузер послал бы сам, поэтому источник проверяется до
    // аутентификации: чужая страница получает 403, а не 401.
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/strategy',
      headers: { origin: 'https://attacker.example' },
      payload: { title: 'Head of Product' },
    });

    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('origin_not_allowed');
  });
});
