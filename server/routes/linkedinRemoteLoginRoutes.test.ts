import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { AuthService } from '../auth/authService';
import { SqliteLinkedinPoolRepository } from '../linkedinPool/sqliteLinkedinPoolRepository';
import { RemoteLoginError, type LinkedinRemoteLoginService } from '../linkedinPool/linkedinRemoteLogin';

const ADMIN = { username: 'admin.test', password: 'admin-password-for-tests' };
const CANDIDATE = { username: 'candidate.test', password: 'candidate-password-for-tests' };
const ORIGIN = 'http://localhost:3000';
const LOGIN_ID = 'abcdefghijklmnopqrstuvwxyz012345';
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function fakeService() {
  return {
    start: vi.fn(async () => ({ loginId: LOGIN_ID })),
    frame: vi.fn(() => ({ state: 'login', url: 'https://www.linkedin.com/login', imageBase64: 'QUJD' })),
    input: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-remote-routes-'));
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
  const service = fakeService();
  const config = {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'x',
    openRouterKey: 'x',
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 8),
    databasePath,
    model: 'gpt-5.6-sol',
    staticRoot: directory,
    release: 'test',
    logLevel: 'fatal',
    secureCookies: false,
    allowedOrigins: [ORIGIN],
    seedAccounts: [],
  } as ServerConfig;
  const app = await buildApp({
    config,
    coachProvider: { createTurn: async () => Promise.reject(new Error('unused')) },
    candidateStore: candidates,
    authService: auth,
    linkedinPool: repository,
    linkedinRemoteLogin: service as unknown as LinkedinRemoteLoginService,
    serveStatic: false,
  });
  cleanups.push(async () => {
    await app.close();
    repository.close();
    auth.close();
    candidates.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const account = repository.create({
    adminLabel: 'Пул',
    emailLogin: 'pool@example.test',
    idempotencyKey: crypto.randomUUID(),
    actorUserId: 'a',
    actorUsername: 'a',
  }).account;
  return { app, service, repository, accountId: account.id };
}

async function cookieFor(app: Awaited<ReturnType<typeof buildApp>>, user: typeof ADMIN) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: user,
  });
  return String(response.headers['set-cookie']).split(';')[0] ?? '';
}

describe('LinkedIn remote login routes (B373)', () => {
  it('rejects anonymous and candidate callers', async () => {
    const { app, accountId } = await setup();
    const url = `/api/v1/admin/linkedin/accounts/${accountId}/remote-login`;
    const anonymous = await app.inject({ method: 'POST', url, headers: { origin: ORIGIN } });
    expect(anonymous.statusCode).toBe(401);
    const candidate = await cookieFor(app, CANDIDATE);
    const denied = await app.inject({ method: 'POST', url, headers: { cookie: candidate, origin: ORIGIN } });
    expect(denied.statusCode).toBe(403);
    const frame = await app.inject({ method: 'GET', url: `${url}/${LOGIN_ID}/frame`, headers: { cookie: candidate } });
    expect(frame.statusCode).toBe(403);
  });

  it('starts a login for an admin and passes the account timezone and actor', async () => {
    const { app, service, accountId } = await setup();
    const cookie = await cookieFor(app, ADMIN);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/remote-login`,
      headers: { cookie, origin: ORIGIN },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({ loginId: LOGIN_ID });
    expect(service.start).toHaveBeenCalledWith(accountId, expect.any(String), {
      actorUserId: expect.any(String),
      actorUsername: ADMIN.username,
    });
  });

  it('answers 404 for an unknown account and maps service errors', async () => {
    const { app, service, accountId } = await setup();
    const cookie = await cookieFor(app, ADMIN);
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/linkedin/accounts/99999999-9999-4999-8999-999999999999/remote-login',
      headers: { cookie, origin: ORIGIN },
    });
    expect(unknown.statusCode).toBe(404);
    service.start.mockRejectedValueOnce(new RemoteLoginError('remote_login_already_active'));
    const conflict = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/remote-login`,
      headers: { cookie, origin: ORIGIN },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('remote_login_already_active');
  });

  it('returns a frame without caching and 404 for a foreign login id', async () => {
    const { app, service, accountId } = await setup();
    const cookie = await cookieFor(app, ADMIN);
    const url = `/api/v1/admin/linkedin/accounts/${accountId}/remote-login/${LOGIN_ID}/frame`;
    const ok = await app.inject({ method: 'GET', url, headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.json().data.state).toBe('login');
    service.frame.mockImplementationOnce(() => {
      throw new RemoteLoginError('remote_login_not_found');
    });
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(404);
    service.frame.mockImplementationOnce(() => {
      throw new RemoteLoginError('remote_login_rate_limited');
    });
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(429);
  });

  it('validates input: whitelist of keys, page bounds, text length', async () => {
    const { app, service, accountId } = await setup();
    const cookie = await cookieFor(app, ADMIN);
    const url = `/api/v1/admin/linkedin/accounts/${accountId}/remote-login/${LOGIN_ID}/input`;
    const send = (payload: unknown) =>
      app.inject({ method: 'POST', url, headers: { cookie, origin: ORIGIN }, payload: payload as object });
    expect((await send({ type: 'click', x: 10, y: 20 })).statusCode).toBe(204);
    expect((await send({ type: 'text', text: 'hello' })).statusCode).toBe(204);
    expect((await send({ type: 'key', key: 'Enter' })).statusCode).toBe(204);
    expect((await send({ type: 'key', key: 'F12' })).statusCode).toBe(422);
    expect((await send({ type: 'click', x: 5_000, y: 1 })).statusCode).toBe(422);
    expect((await send({ type: 'text', text: 'x'.repeat(257) })).statusCode).toBe(422);
    expect((await send({ type: 'unknown' })).statusCode).toBe(422);
    expect(service.input).toHaveBeenCalledTimes(3);
    service.input.mockRejectedValueOnce(new RemoteLoginError('remote_login_rate_limited'));
    expect((await send({ type: 'key', key: 'Tab' })).statusCode).toBe(429);
  });

  it('closes a login with DELETE', async () => {
    const { app, service, accountId } = await setup();
    const cookie = await cookieFor(app, ADMIN);
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/linkedin/accounts/${accountId}/remote-login/${LOGIN_ID}`,
      headers: { cookie, origin: ORIGIN },
    });
    expect(response.statusCode).toBe(204);
    expect(service.close).toHaveBeenCalledWith(accountId, LOGIN_ID);
  });
});
