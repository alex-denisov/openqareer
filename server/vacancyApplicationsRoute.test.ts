import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/**
 * Ручной отклик и воронка (B165, срез 1, узлы 5, 6, 8, 9).
 *
 * Проверяется петля целиком: открытие площадки откликом не считается,
 * подтверждение кандидата считается, и повторное открытие подтверждённый
 * отклик не откатывает.
 */
async function createApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

const ORIGIN = { origin: 'http://localhost:3000' };
const URL = '/api/v1/candidate/vacancy-applications';

const vacancy = {
  title: 'Продуктовый аналитик',
  company: 'FinCloud',
  url: 'https://example.test/jobs/1',
  source: 'src-remotive',
};

describe('vacancy applications route', () => {
  it('открытие площадки откликом не считается', async () => {
    const { app, authorization } = await createApp();

    const opened = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'opened', vacancy },
    });

    expect(opened.statusCode).toBe(200);
    expect(opened.json().data.status).toBe('opened');
    expect(opened.json().data.appliedAt).toBeNull();

    const list = await app.inject({ method: 'GET', url: URL, headers: { authorization } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].vacancy.title).toBe('Продуктовый аналитик');
  });

  it('подтверждение кандидата записывается с датой и провенансом', async () => {
    const { app, authorization } = await createApp();

    await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'opened', vacancy },
    });
    const applied = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });

    expect(applied.statusCode).toBe(200);
    const record = applied.json().data;
    expect(record.status).toBe('applied');
    expect(record.confirmedBy).toBe('candidate');
    expect(typeof record.appliedAt).toBe('string');
    expect(record.openedAt).not.toBeNull();
  });

  it('повторное открытие ссылки не откатывает подтверждённый отклик', async () => {
    const { app, authorization } = await createApp();

    await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });
    const reopened = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'opened', vacancy },
    });

    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().data.status).toBe('applied');
  });

  it('без сессии кандидата ни списка, ни записи', async () => {
    const { app } = await createApp();

    expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: URL,
          headers: ORIGIN,
          payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
        })
      ).statusCode,
    ).toBe(401);
  });

  // Bearer-токен браузер сам не подставляет, поэтому CSRF проверяется на
  // запросе без него — ровно так же, как в остальных изменяющих маршрутах.
  it('чужой origin без bearer-токена не записывает отклик', async () => {
    const { app } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: URL,
      headers: { origin: 'https://attacker.test' },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });

    expect(response.statusCode).toBe(403);
  });
});

/** Снимок отклика однажды станет ссылкой на экране — схема должна её сузить. */
describe('vacancy applications route · безопасность ссылки', () => {
  it('не принимает ссылку с javascript-схемой', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization, ...ORIGIN },
      payload: {
        clusterId: 'cluster-1',
        status: 'applied',
        vacancy: { ...vacancy, url: 'javascript:alert(1)' },
      },
    });

    expect(response.statusCode).toBe(422);
  });
});
