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
const provider: CoachProvider = {
  async createTurn() {
    throw new Error('not used');
  },
};
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
  await auth.seedAccounts(
    [
      { ...ADMIN, role: 'admin' },
      { ...CANDIDATE, role: 'candidate' },
    ],
    candidates,
  );
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

function validSessionCookies() {
  return [
    {
      name: 'li_at',
      value: 'route-test-session-secret',
      domain: 'linkedin.com',
      path: '/',
      expiresAt: Math.floor((Date.now() + 60 * 60_000) / 1_000),
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ];
}

async function createReadyAccount(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/linkedin/accounts',
    headers: {
      cookie: adminCookie,
      origin: 'http://localhost:3000',
      'idempotency-key': '77777777-7777-4777-8777-777777777777',
    },
    payload: { adminLabel: 'Пул', emailLogin: 'pool-route@example.test' },
  });
  const accountId = created.json().data.id as string;
  const login = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
    headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
  });
  const complete = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/linkedin/accounts/${accountId}/session/complete`,
    headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
    payload: {
      handle: login.json().data.lease.handle,
      state: 'ready',
      accountMarker: 'route-profile-marker',
    },
  });
  expect(complete.statusCode).toBe(200);
  return accountId;
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

    const unmarkedComplete = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session/complete`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
      payload: { handle: login.json().data.lease.handle, state: 'ready' },
    });
    expect(unmarkedComplete.statusCode).toBe(422);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session/complete`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
      payload: {
        handle: login.json().data.lease.handle,
        state: 'ready',
        accountMarker: 'marker-1',
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().data.state).toBe('ready');

    const probe = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/probe`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
    });
    expect(probe.statusCode).toBe(200);
    expect(probe.json().data.state).toBe('login_required');
    expect(probe.json().data.lastFailureCode).toBe('provider_probe_unavailable');
  });

  it('accepts an admin-chosen provider identifier that is not an email', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/linkedin/accounts',
      headers: {
        cookie: adminCookie,
        origin: 'http://localhost:3000',
        'idempotency-key': '66666666-6666-4666-8666-666666666666',
      },
      payload: { adminLabel: 'LinkedIn-1', emailLogin: 'LinkedIn-1' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.emailLogin).toBe('LinkedIn-1');
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

  it('stores only an encrypted session summary behind admin auth and CSRF, then deletes it', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const candidateCookie = await signIn(app, CANDIDATE);
    const accountId = await createReadyAccount(app, adminCookie);
    const cookies = validSessionCookies();

    const forbidden = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
      headers: { cookie: candidateCookie, origin: 'http://localhost:3000' },
      payload: { cookies },
    });
    expect(forbidden.statusCode).toBe(403);

    const csrf = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
      headers: { cookie: adminCookie },
      payload: { cookies },
    });
    expect(csrf.statusCode).toBe(403);

    const missingLiAt = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
      payload: {
        cookies: [{ ...cookies[0]!, name: 'liap' }],
      },
    });
    expect(missingLiAt.statusCode).toBe(422);
    expect(missingLiAt.json().error.code).toBe('linkedin_session_cookie_required');

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
      payload: { cookies },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('route-test-session-secret');
    expect(saved.json().data).toMatchObject({ cookieCount: 1, revision: 1 });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/linkedin/accounts',
      headers: { cookie: adminCookie },
    });
    expect(list.json().data.accounts[0].serverSession).toMatchObject({ cookieCount: 1 });
    expect(JSON.stringify(list.json().data.accounts[0].serverSession)).not.toContain(
      'route-test-session-secret',
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
    });
    expect(deleted.statusCode).toBe(204);
    const afterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/linkedin/accounts',
      headers: { cookie: adminCookie },
    });
    expect(afterDelete.json().data.accounts[0].serverSession).toBeNull();
  });

  it('returns 413 before parsing an oversized server-session upload', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const accountId = await createReadyAccount(app, adminCookie);
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/session`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
      payload: {
        cookies: [
          {
            ...validSessionCookies()[0],
            value: 'x'.repeat(70_000),
          },
        ],
      },
    });
    expect(response.statusCode).toBe(413);
  });
});
