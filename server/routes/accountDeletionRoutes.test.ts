import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import { SqliteAccountDeletionStore } from '../auth/accountDeletionStore';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { sweepAccountDeletions } from './accountDeletionRoutes';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const DELETION = '/api/v1/candidate/account/deletion';

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-deletion-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test'],
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const sessions = new Map([
    ['token-flagged', principal('flagged.test')],
    ['token-plain', principal('plain.test')],
  ]);
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return app;
}

function call(app: App, method: 'GET' | 'POST' | 'DELETE', url: string, token?: string) {
  return app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
  });
}

async function pausedUntil(app: App, token: string): Promise<string | null> {
  const response = await call(app, 'GET', '/api/v1/candidate/automation', token);
  return response.json().data.settings.pausedUntil ?? null;
}

const flagged = 'token-flagged';

describe('account deletion routes (B689)', () => {
  it('answers like a missing address without the B640 flag or a session', async () => {
    const app = await setup();
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      expect((await call(app, method, DELETION, 'token-plain')).statusCode).toBe(404);
      expect((await call(app, method, DELETION)).statusCode).toBe(404);
    }
  });

  it('rejects a request from a foreign page', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: DELETION,
      headers: { cookie: `openqareer_session=${flagged}`, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect((await call(app, 'GET', DELETION, flagged)).json().data).toBeNull();
  });

  it('schedules deletion 30 days ahead and pauses auto-responses at once', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-19T10:00:00.000Z'), toFake: ['Date'] });
    const app = await setup();
    expect((await call(app, 'GET', DELETION, flagged)).json().data).toBeNull();

    const scheduled = await call(app, 'POST', DELETION, flagged);
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json().data).toEqual({
      requestedAt: '2026-11-19T10:00:00.000Z',
      purgeAfter: '2026-12-19T10:00:00.000Z',
    });
    expect((await call(app, 'GET', DELETION, flagged)).json().data).toEqual(scheduled.json().data);
    expect(new Date((await pausedUntil(app, flagged))!).getTime()).toBeGreaterThan(Date.now());

    vi.setSystemTime(new Date('2026-11-25T10:00:00.000Z'));
    expect((await call(app, 'POST', DELETION, flagged)).json().data).toEqual(scheduled.json().data);
  });

  it('brings the account back and lifts the pause the deletion set', async () => {
    const app = await setup();
    await call(app, 'POST', DELETION, flagged);
    const restored = await call(app, 'DELETE', DELETION, flagged);
    expect(restored.statusCode).toBe(204);
    expect((await call(app, 'GET', DELETION, flagged)).json().data).toBeNull();
    expect(await pausedUntil(app, flagged)).toBeNull();
    expect((await call(app, 'DELETE', DELETION, flagged)).statusCode).toBe(204);
  });
});

describe('sweepAccountDeletions', () => {
  it('purges accounts whose deadline passed and forgets their requests', async () => {
    const store = new SqliteAccountDeletionStore(new DatabaseSync(':memory:'));
    store.schedule('cand-due', new Date('2026-11-01T00:00:00.000Z'), null);
    store.schedule('cand-wait', new Date('2026-11-19T00:00:00.000Z'), null);
    const purged: string[] = [];
    const count = sweepAccountDeletions({
      store,
      purge: (candidateId) => purged.push(candidateId),
      now: new Date('2026-12-02T00:00:00.000Z'),
    });
    expect(count).toBe(1);
    expect(purged).toEqual(['cand-due']);
    expect(store.get('cand-due')).toBeNull();
    expect(store.get('cand-wait')).not.toBeNull();
  });

  it('postpones a failed purge by an hour, so the next sweep retries it', () => {
    const store = new SqliteAccountDeletionStore(new DatabaseSync(':memory:'));
    store.schedule('cand-due', new Date('2026-11-01T00:00:00.000Z'), null);
    const failures: string[] = [];
    const count = sweepAccountDeletions({
      store,
      purge: () => {
        throw new Error('disk');
      },
      now: new Date('2026-12-02T00:00:00.000Z'),
      onError: (candidateId) => failures.push(candidateId),
    });
    expect(count).toBe(0);
    expect(failures).toEqual(['cand-due']);
    expect(store.get('cand-due')?.purgeAfter).toBe('2026-12-02T01:00:00.000Z');
  });

  it('skips a request the candidate cancelled after the listing', () => {
    const store = new SqliteAccountDeletionStore(new DatabaseSync(':memory:'));
    store.schedule('cand-due', new Date('2026-11-01T00:00:00.000Z'), null);
    const purged: string[] = [];
    const racing = {
      ...store,
      listDue: store.listDue.bind(store),
      remove: store.remove.bind(store),
      postpone: store.postpone.bind(store),
      get: () => null,
    };
    expect(
      sweepAccountDeletions({
        store: racing,
        purge: (id) => purged.push(id),
        now: new Date('2026-12-02T00:00:00.000Z'),
      }),
    ).toBe(0);
    expect(purged).toEqual([]);
  });
});
