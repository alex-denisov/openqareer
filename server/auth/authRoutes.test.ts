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
        careerTrack: null,
        actionProposals: [],
      },
    };
  },
};

async function createApp(
  onPasswordReset?: (input: {
    email: string;
    displayName: string | null;
    token: string;
  }) => Promise<void>,
  searchVacancies?: Parameters<typeof buildApp>[0]['searchVacancies'],
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-auth-routes-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath, onPasswordReset });
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
    oauthProviders: {},
    ...(onPasswordReset
      ? {
          accountEmail: {
            apiKey: 'test-resend-key',
            from: 'openqareer <noreply@openqareer.test>',
            publicBaseUrl: 'http://localhost:3000',
          },
        }
      : {}),
  };
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    serveStatic: false,
    ...(searchVacancies ? { searchVacancies } : {}),
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
  it('creates an account profile and exposes the current session without leaking its token', async () => {
    const app = await createApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        username: 'profile.owner',
        email: 'Owner@Example.com',
        displayName: 'Алексей Денисов',
        password: 'candidate-password-for-tests',
      },
    });

    expect(registered.statusCode).toBe(201);
    expect(registered.json().data).toMatchObject({
      username: 'profile.owner',
      email: 'owner@example.com',
      displayName: 'Алексей Денисов',
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];
    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie },
    });

    expect(account.statusCode).toBe(200);
    expect(account.json().data).toMatchObject({
      username: 'profile.owner',
      email: 'owner@example.com',
      displayName: 'Алексей Денисов',
      profile: {
        headline: null,
        location: null,
        workMode: null,
      },
      sessions: [
        {
          current: true,
        },
      ],
    });
    expect(JSON.stringify(account.json())).not.toContain('oqs_');
  });

  it('updates candidate-owned account fields through an origin-protected route', async () => {
    const app = await createApp();
    const candidate = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/account/profile',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        email: 'Candidate@Example.com',
        displayName: 'Мария Волкова',
        headline: 'Product Operations Lead',
        location: 'Берлин, Германия',
        workMode: 'hybrid',
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      email: 'candidate@example.com',
      displayName: 'Мария Волкова',
      profile: {
        headline: 'Product Operations Lead',
        location: 'Берлин, Германия',
        workMode: 'hybrid',
      },
    });
  });

  it('changes the password and rotates every existing session', async () => {
    const app = await createApp();
    const first = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );
    const second = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );

    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password',
      headers: {
        cookie: second.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        currentPassword: 'candidate-password-for-tests',
        newPassword: 'candidate-password-after-change',
      },
    });

    expect(changed.statusCode).toBe(200);
    const rotatedCookie = String(changed.headers['set-cookie']).split(';')[0];
    expect(rotatedCookie).not.toBe(second.cookie);
    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: first.cookie },
    });
    expect(oldSession.json().data).toBeNull();
    expect(
      (await login(app, 'candidate.test', 'candidate-password-for-tests'))
        .response.statusCode,
    ).toBe(401);
    expect(
      (await login(app, 'candidate.test', 'candidate-password-after-change'))
        .response.statusCode,
    ).toBe(200);
  });

  it('resets a forgotten password through a one-time emailed token', async () => {
    const deliveries: Array<{ email: string; token: string }> = [];
    const app = await createApp(async ({ email, token }) => {
      deliveries.push({ email, token });
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        username: 'recover.me',
        email: 'recover@example.com',
        displayName: 'Анна Смирнова',
        password: 'candidate-password-before-reset',
      },
    });

    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset-requests',
      headers: { origin: 'http://localhost:3000' },
      payload: { identifier: 'RECOVER@EXAMPLE.COM' },
    });

    expect(requested.statusCode).toBe(202);
    expect(requested.json().data).toEqual({
      accepted: true,
      deliveryConfigured: true,
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.email).toBe('recover@example.com');
    expect(deliveries[0]?.token).toMatch(/^oqr_[A-Za-z0-9_-]{40,}$/);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-resets',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        token: deliveries[0]?.token,
        newPassword: 'candidate-password-after-reset',
      },
    });
    expect(reset.statusCode).toBe(200);
    expect(
      (await login(app, 'recover.me', 'candidate-password-before-reset'))
        .response.statusCode,
    ).toBe(401);
    expect(
      (await login(app, 'recover.me', 'candidate-password-after-reset'))
        .response.statusCode,
    ).toBe(200);
  });

  it('revokes every session except the one making the request', async () => {
    const app = await createApp();
    const older = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );
    const current = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );

    const revoked = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account/sessions',
      headers: {
        cookie: current.cookie,
        origin: 'http://localhost:3000',
      },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().data).toEqual({ revoked: 1 });

    const oldMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: older.cookie },
    });
    const currentMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: current.cookie },
    });
    expect(oldMe.json().data).toBeNull();
    expect(currentMe.json().data).toMatchObject({ role: 'candidate' });
  });

  it('uploads, downloads and deletes a candidate-owned CV', async () => {
    const app = await createApp();
    const candidate = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );
    const contentBase64 = Buffer.from('%PDF candidate CV 881').toString(
      'base64',
    );

    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/documents',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        kind: 'resume',
        source: 'upload',
        fileName: 'candidate-cv.pdf',
        mimeType: 'application/pdf',
        contentBase64,
        extractedText: 'Руководил операциями и улучшал удержание на 18%.',
        parseStatus: 'ready',
      },
    });
    expect(uploaded.statusCode).toBe(201);
    const documentId = uploaded.json().data.document.id as string;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie: candidate.cookie },
    });
    expect(listed.json().data.documents).toMatchObject([
      { id: documentId, fileName: 'candidate-cv.pdf', kind: 'resume' },
    ]);

    const retentionUntil = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const retained = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/documents/${documentId}/retention`,
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: { retentionUntil },
    });
    expect(retained.statusCode).toBe(200);
    expect(retained.json().data).toMatchObject({
      id: documentId,
      retentionUntil,
    });

    const downloaded = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}`,
      headers: { cookie: candidate.cookie },
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.json().data).toMatchObject({
      id: documentId,
      contentBase64,
      extractedText: 'Руководил операциями и улучшал удержание на 18%.',
    });

    const binaryDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}/download`,
      headers: { cookie: candidate.cookie },
    });
    expect(binaryDownload.statusCode).toBe(200);
    expect(binaryDownload.headers['content-type']).toBe('application/pdf');
    expect(binaryDownload.headers['content-disposition']).toContain(
      "filename*=UTF-8''candidate-cv.pdf",
    );
    expect(binaryDownload.rawPayload).toEqual(
      Buffer.from('%PDF candidate CV 881'),
    );
    expect(binaryDownload.body).not.toContain('Руководил операциями');
    for (let requestNumber = 2; requestNumber <= 30; requestNumber += 1) {
      const repeated = await app.inject({
        method: 'GET',
        url: `/api/v1/candidate/documents/${documentId}/download`,
        headers: { cookie: candidate.cookie },
      });
      expect(repeated.statusCode).toBe(200);
    }
    const limitedDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}/download`,
      headers: { cookie: candidate.cookie },
    });
    expect(limitedDownload.statusCode).toBe(429);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/candidate/documents/${documentId}`,
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
    });
    expect(deleted.statusCode).toBe(204);
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/documents/${documentId}`,
      headers: { cookie: candidate.cookie },
    });
    expect(afterDelete.statusCode).toBe(404);
  });

  it('creates and immediately refreshes a recurring vacancy search', async () => {
    const app = await createApp(undefined, async ({ text }) => ({
      source: 'hh',
      query: text,
      found: 17,
      fetchedAt: '2026-08-13T11:00:00.000Z',
      items: [
        {
          id: '1771',
          title: 'Head of Operations',
          company: 'Synthetic Company',
          location: 'Москва',
          sourceUrl: 'https://hh.ru/vacancy/1771',
          publishedAt: null,
          salary: null,
        },
      ],
    }));
    const candidate = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-subscriptions',
      headers: {
        cookie: candidate.cookie,
        origin: 'http://localhost:3000',
      },
      payload: {
        source: 'hh',
        query: 'Head of Operations',
        cadenceMinutes: 360,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.subscription).toMatchObject({
      query: 'Head of Operations',
      status: 'active',
      lastSuccessAt: '2026-08-13T11:00:00.000Z',
      analytics: { sampleSize: 1, sourceFound: 17 },
    });
    expect(created.json().data.vacancies).toMatchObject([
      { externalId: '1771', title: 'Head of Operations' },
    ]);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancy-subscriptions',
      headers: { cookie: candidate.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);
  });

  it('pauses, manually refreshes and deletes a saved vacancy search', async () => {
    let fetchedAt = '2026-08-13T12:00:00.000Z';
    const app = await createApp(undefined, async ({ text }) => ({
      source: 'hh',
      query: text,
      found: 0,
      fetchedAt,
      items: [],
    }));
    const candidate = await login(
      app,
      'candidate.test',
      'candidate-password-for-tests',
    );
    const headers = {
      cookie: candidate.cookie,
      origin: 'http://localhost:3000',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-subscriptions',
      headers,
      payload: {
        source: 'hh',
        query: 'operations director',
        cadenceMinutes: 360,
      },
    });
    const subscriptionId = created.json().data.subscription.id as string;

    const paused = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/vacancy-subscriptions/${subscriptionId}`,
      headers,
      payload: { status: 'paused' },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().data.status).toBe('paused');

    fetchedAt = '2026-08-13T13:00:00.000Z';
    const refreshed = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/vacancy-subscriptions/${subscriptionId}/refresh`,
      headers,
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.subscription).toMatchObject({
      status: 'paused',
      lastSuccessAt: fetchedAt,
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/candidate/vacancy-subscriptions/${subscriptionId}`,
      headers,
    });
    expect(deleted.statusCode).toBe(204);
  });

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
