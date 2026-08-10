import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import { AuthService } from './authService';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

const provider: CoachProvider = {
  async createTurn() {
    return {
      provider: 'openrouter',
      model: 'nemotron-test',
      responseId: 'response-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      result: {
        message: 'Уточним результат.',
        phase: 'evidence',
        memoryCandidates: [],
        nextQuestion: 'Что изменилось?',
        completeness: { known: [], unknown: ['Результат'] },
        safety: { needsHuman: false, reason: null },
      },
    };
  },
};

async function createApp() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-auth-routes-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts(
    [
      {
        username: 'admin.test',
        password: 'admin-password-for-tests',
        role: 'admin',
      },
      {
        username: 'candidate.test',
        password: 'candidate-password-for-tests',
        role: 'candidate',
      },
    ],
    candidates,
  );
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
    serveStatic: false,
  });
  resources.push({ app, auth, candidates, directory });
  return app;
}

async function login(
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  password: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: {
      origin: 'http://localhost:3000',
    },
    payload: { username, password },
  });
  return {
    response,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  };
}

describe('cookie auth routes', () => {
  it('creates a personal candidate account and starts its own cookie session', async () => {
    const app = await createApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        username: 'new.candidate',
        password: 'candidate-password-for-tests',
      },
    });

    expect(registered.statusCode).toBe(201);
    expect(registered.json().data).toMatchObject({
      username: 'new.candidate',
      role: 'candidate',
      isTest: false,
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const profile = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().data.candidate.dataClass).toBe('personal');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        username: 'NEW.CANDIDATE',
        password: 'another-password-for-tests',
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('username_taken');
  });

  it('enforces origin, role and candidate ownership boundaries', async () => {
    const app = await createApp();
    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'candidate.test',
        password: 'candidate-password-for-tests',
      },
    });
    expect(noOrigin.statusCode).toBe(403);

    const candidate = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );
    expect(candidate.response.statusCode).toBe(200);
    expect(candidate.response.headers['set-cookie']).toContain('HttpOnly');
    expect(candidate.response.headers['set-cookie']).toContain('SameSite=Strict');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: candidate.cookie },
    });
    expect(me.json().data).toMatchObject({
      role: 'candidate',
      isTest: true,
    });

    const candidateProviderStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
      headers: { cookie: candidate.cookie },
    });
    expect(candidateProviderStatus.statusCode).toBe(401);

    const csrfBlocked = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        cookie: candidate.cookie,
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: 'Я запускал продукт.',
      },
    });
    expect(csrfBlocked.statusCode).toBe(403);

    const coach = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
        'idempotency-key': randomUUID(),
      },
      payload: {
        messageId: randomUUID(),
        content: 'Я запускал продукт.',
      },
    });
    expect(coach.statusCode).toBe(200);

    const admin = await login(
      app,
      'admin.test',
      'admin-password-for-tests',
    );
    const adminProviderStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
      headers: { cookie: admin.cookie },
    });
    expect(adminProviderStatus.statusCode).toBe(200);
    const adminCandidateProfile = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie: admin.cookie },
    });
    expect(adminCandidateProfile.statusCode).toBe(401);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: candidate.cookie },
    });
    expect(afterLogout.statusCode).toBe(200);
    expect(afterLogout.json().data).toBeNull();
  });
});
