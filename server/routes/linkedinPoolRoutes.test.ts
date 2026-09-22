import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { AuthService } from '../auth/authService';
import { SqliteLinkedinPoolRepository } from '../linkedinPool/sqliteLinkedinPoolRepository';
import type { CoachProvider } from '../providers/coachProvider';

const ADMIN = { username: 'admin.test', password: 'admin-password-for-tests' };
const CANDIDATE = { username: 'candidate.test', password: 'candidate-password-for-tests' };
const provider: CoachProvider = { async createTurn() { throw new Error('not used'); } };
const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  repository: SqliteLinkedinPoolRepository;
  directory: string;
}> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.repository.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});
async function createApp() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-linkedin-routes-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 8) });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts([
    { ...ADMIN, role: 'admin' },
    { ...CANDIDATE, role: 'candidate' },
  ], candidates);
  const repository = new SqliteLinkedinPoolRepository({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
    runtimeRoot: join(directory, 'runtime'),
  });
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'not-used-by-test',
    openRouterKey: 'not-used-by-test',
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 8),
    databasePath,
    model: 'gpt-5.6-sol',
    staticRoot: directory,
    release: 'test',
    logLevel: 'fatal',
    secureCookies: false,
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
  };
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    linkedinPool: repository,
    serveStatic: false,
  });
  resources.push({ app, auth, candidates, repository, directory });
  return app;
}

async function signIn(
  app: Awaited<ReturnType<typeof buildApp>>,
  account: { username: string; password: string },
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:3000' },
    payload: account,
  });
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0];
}

describe('admin LinkedIn pool boundary', () => {
  it('does not disclose the pool route or identifier to a candidate', async () => {
    const app = await createApp();
    const cookie = await signIn(app, CANDIDATE);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/linkedin/accounts',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('LinkedIn');
    expect(response.body).not.toContain('pool-admin@example.test');
  });

  it('returns the full email login only through an authenticated admin route', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/linkedin/accounts',
      headers: {
        cookie: adminCookie,
        origin: 'http://localhost:3000',
        'idempotency-key': '33333333-3333-4333-8333-333333333333',
      },
      payload: {
        adminLabel: 'Основной пул',
        emailLogin: 'pool-admin@example.test',
        providerAccountMarker: 'marker-1',
      },
    });

    expect(create.statusCode).toBe(201);
    expect(create.json().data.emailLogin).toBe('pool-admin@example.test');
    const accountId = create.json().data.id as string;
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/linkedin/accounts',
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.accounts[0].emailLogin).toBe('pool-admin@example.test');

    const login = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
    });
    expect(login.statusCode).toBe(202);
    expect(login.json().data.account.state).toBe('user_action_required');
    expect(login.json().data.lease.webRemote).toBe(false);

    const probe = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/probe`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json().data.state).toBe('login_required');
    expect(probe.json().data.lastFailureCode).toBe('provider_probe_unavailable');
  });

  it('requires the browser origin for admin mutations', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/linkedin/accounts',
      headers: {
        cookie: adminCookie,
        'idempotency-key': '44444444-4444-4444-8444-444444444444',
      },
      payload: { adminLabel: 'Без origin', emailLogin: 'no-origin@example.test' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('origin_not_allowed');
  });
});
