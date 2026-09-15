import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { apps, config, noSessions, stores, successProvider } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { AuthPrincipal, SessionAuth } from '../auth/authService';

/**
 * Размер кучи и пула — устройство инфраструктуры: читает только администратор,
 * публичный `/health` его не отдаёт (B220, ревью безопасности).
 */

const adminPrincipal: AuthPrincipal = {
  userId: 'admin-1',
  username: 'admin.test',
  email: null,
  displayName: null,
  role: 'admin',
  isTest: true,
  candidate: null,
};

const adminSessions: SessionAuth = {
  ...noSessions,
  authenticate: (token: string) => (token === 'admin-session' ? adminPrincipal : null),
};

async function createApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: adminSessions,
    serveStatic: false,
    runtimeMemory: () => ({
      ingestPaused: true,
      heapUsedMb: 1200,
      heapLimitMb: 1536,
      poolSize: 134557,
    }),
  });
  apps.push(app);
  stores.push(candidateStore);
  return app;
}

describe('память службы для администратора', () => {
  it('без сессии администратора — 401', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/runtime-memory' });

    expect(response.statusCode).toBe(401);
  });

  it('администратор видит кучу, предел, паузу и размер пула', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/runtime-memory',
      headers: { authorization: 'Bearer admin-session' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      ingestPaused: true,
      heapUsedMb: 1200,
      heapLimitMb: 1536,
      poolSize: 134557,
    });
  });
});
