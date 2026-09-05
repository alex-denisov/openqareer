import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import { AuthService } from './authService';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';

/**
 * B089 — the administrator directory. The owner asked for an admin account and
 * an admin screen; an account without a screen is a password to nowhere, and a
 * screen without an authorisation gate is worse than no screen at all. These
 * tests pin the gate first and the payload second.
 */

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
    throw new Error('the admin directory must not call a language model');
  },
};

const ADMIN = { username: 'admin.test', password: 'admin-password-for-tests' };
const CANDIDATE = {
  username: 'candidate.test',
  password: 'candidate-password-for-tests',
};

async function createApp() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-admin-routes-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts(
    [
      { ...ADMIN, role: 'admin' as const },
      { ...CANDIDATE, role: 'candidate' as const },
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
    searchVacancies: async () => ({
      source: 'hh',
      query: 'Frontend',
      found: 1,
      fetchedAt: new Date().toISOString(),
      items: [
        {
          id: 'test-1',
          title: 'Frontend Developer',
          company: 'Test Corp',
          location: 'Remote',
          sourceUrl: 'https://hh.ru/1',
          publishedAt: new Date().toISOString(),
          salary: null,
          workMode: 'remote',
          requirements: ['React'],
        },
      ],
    }),
  });
  resources.push({ app, auth, candidates, directory });
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

async function register(
  app: Awaited<ReturnType<typeof buildApp>>,
  displayName: string,
  email: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: 'http://localhost:3000' },
    payload: {
      displayName,
      email,
      password: 'candidate-password-for-tests',
      legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; username: string };
}

describe('GET /api/v1/admin/users', () => {
  it('refuses an anonymous caller', async () => {
    const app = await createApp();

    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/users' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('refuses a signed-in candidate, who must never see other accounts', async () => {
    const app = await createApp();
    const cookie = await signIn(app, CANDIDATE);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden');
    expect(response.body).not.toContain(ADMIN.username);
  });

  it('lists every account for an administrator, newest first', async () => {
    const app = await createApp();
    await register(app, 'Мария', 'maria@example.com');
    const cookie = await signIn(app, ADMIN);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.total).toBe(3);
    expect(data.users).toHaveLength(3);
    expect(data.users[0].displayName).toBe('Мария');
    expect(data.users.map((user: { username: string }) => user.username)).toContain(
      ADMIN.username,
    );

    const administrator = data.users.find(
      (user: { role: string }) => user.role === 'admin',
    );
    expect(administrator.candidateId).toBeNull();
    expect(administrator.activeSessions).toBe(1);
  });

  it('never puts a password, a hash or a session token in the payload', async () => {
    const app = await createApp();
    const cookie = await signIn(app, ADMIN);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie },
    });

    const body = response.body.toLowerCase();
    for (const secret of ['password', 'hash', 'salt', 'token']) {
      expect(body, `the directory leaked "${secret}"`).not.toContain(secret);
    }
  });

  it('searches by username, email and display name', async () => {
    const app = await createApp();
    await register(app, 'Мария Иванова', 'maria@example.com');
    await register(app, 'Пётр Сидоров', 'petr@example.com');
    const cookie = await signIn(app, ADMIN);

    const byName = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?query=Мария',
      headers: { cookie },
    });
    expect(byName.json().data.total).toBe(1);
    expect(byName.json().data.users[0].email).toBe('maria@example.com');

    const byEmail = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?query=petr@example.com',
      headers: { cookie },
    });
    expect(byEmail.json().data.total).toBe(1);
    expect(byEmail.json().data.users[0].displayName).toBe('Пётр Сидоров');

    const byUsername = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users?query=${ADMIN.username}`,
      headers: { cookie },
    });
    expect(byUsername.json().data.total).toBe(1);
    expect(byUsername.json().data.users[0].role).toBe('admin');
  });

  it('pages without losing the total', async () => {
    const app = await createApp();
    await register(app, 'Первый', 'first@example.com');
    await register(app, 'Второй', 'second@example.com');
    const cookie = await signIn(app, ADMIN);

    const page = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?limit=2&offset=2',
      headers: { cookie },
    });

    expect(page.json().data.total).toBe(4);
    expect(page.json().data.users).toHaveLength(2);
  });

  it('refuses a page size it cannot serve instead of silently truncating', async () => {
    const app = await createApp();
    const cookie = await signIn(app, ADMIN);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?limit=5000',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('validation_failed');
  });
});

describe('PATCH /api/v1/admin/users/:userId', () => {
  it('allows an administrator to promote a candidate to admin', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    await register(app, 'Новичок', 'newbie@example.com');
    const directory = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?query=newbie@example.com',
      headers: { cookie: adminCookie },
    });
    const candidateUser = directory.json().data.users[0];

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${candidateUser.id}`,
      headers: { cookie: adminCookie },
      payload: { role: 'admin' },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.role).toBe('admin');
  });

  it('forbids candidate accounts from changing roles', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const candidateCookie = await signIn(app, CANDIDATE);
    await register(app, 'Другой', 'other@example.com');
    const directory = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?query=other@example.com',
      headers: { cookie: adminCookie },
    });
    const candidateUser = directory.json().data.users[0];

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${candidateUser.id}`,
      headers: { cookie: candidateCookie },
      payload: { role: 'admin' },
    });

    expect(updateResponse.statusCode).toBe(403);
  });
});

describe('POST /api/v1/admin/vacancy-sources/:sourceId/test', () => {
  it('allows admin to test a vacancy source with a search query', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);

    const testResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/vacancy-sources/hh/test',
      headers: { cookie: adminCookie },
      payload: { query: 'Frontend' },
    });

    expect(testResponse.statusCode).toBe(200);
    const body = testResponse.json().data;
    expect(body.sourceId).toBe('hh');
    expect(typeof body.latencyMs).toBe('number');
    expect(Array.isArray(body.vacancies)).toBe(true);
  });
});

/**
 * B200 — суперадминка видит живость и доверие раздельно, и каждое число
 * называет свой знаменатель. Без этого «источник отвечает 200» и «источник
 * жив» выглядели на экране одинаково.
 */
describe('GET /api/v1/admin/vacancy-sources', () => {
  it('называет живость и доверие каждой площадки', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancy-sources',
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    const sources = response.json().data;
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.health.liveness.verdict).toBeTypeOf('string');
      expect(source.health.liveness.reason).toBeTypeOf('string');
      expect(source.health.trust.verdict).toBeTypeOf('string');
      // Знаменатель едет вместе с числом (правило B192).
      expect(source.health.trust.completeness.withEmployer).toHaveProperty('of');
      // Подлинность не измерена и не притворяется измеренной.
      expect(source.health.trust.authenticity).toEqual({ measured: false, blockedBy: 'B205' });
    }
  });
});

describe('DELETE /api/v1/admin/users/:userId', () => {
  it('deletes candidate dossier along with the user account', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    await register(app, 'Мария Удаляемая', 'maria.delete@example.com');
    const directory = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?query=maria.delete@example.com',
      headers: { cookie: adminCookie },
    });
    const candidateUser = directory.json().data.users[0];
    expect(candidateUser.candidateId).toBeTruthy();

    const resource = resources[resources.length - 1];
    resource.candidates.startTurn(
      candidateUser.candidateId,
      '51df5f57-df61-4ac2-98af-202608270101',
      {
        messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5847',
        content: 'Тестовое сообщение кандидата для проверки удаления его данных.',
        phase: 'discovery',
      },
    );

    // Direct DB check before deletion: candidate row and message row exist
    const db = (resource.candidates as unknown as { database: DatabaseSync }).database;
    const candBefore = db
      .prepare('SELECT COUNT(*) AS c FROM candidates WHERE id = ?')
      .get(candidateUser.candidateId) as { c: number };
    expect(candBefore.c).toBe(1);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${candidateUser.id}`,
      headers: { cookie: adminCookie },
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ data: { success: true }, meta: expect.any(Object) });

    // Direct DB check after deletion: candidate and user are gone, and audit record describes dossier deletion
    const candAfter = db
      .prepare('SELECT COUNT(*) AS c FROM candidates WHERE id = ?')
      .get(candidateUser.candidateId) as { c: number };
    expect(candAfter.c).toBe(0);

    const userAfter = db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE id = ?')
      .get(candidateUser.id) as { c: number };
    expect(userAfter.c).toBe(0);

    const msgAfter = db
      .prepare('SELECT COUNT(*) AS c FROM messages WHERE candidate_id = ?')
      .get(candidateUser.candidateId) as { c: number };
    expect(msgAfter.c).toBe(0);

    const audit = db
      .prepare(
        'SELECT action, detail FROM admin_audit WHERE subject_user_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(candidateUser.id) as { action: string; detail: string };
    expect(audit.action).toBe('delete_user');
    expect(audit.detail).toBe('User account and candidate dossier deleted');
  });

  it('keeps other candidate dossiers untouched', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    await register(app, 'Мария Первая', 'maria1@example.com');
    await register(app, 'Мария Вторая', 'maria2@example.com');

    const directory = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?query=maria',
      headers: { cookie: adminCookie },
    });
    const users = directory.json().data.users;
    const user1 = users.find((u: { email: string }) => u.email === 'maria1@example.com');
    const user2 = users.find((u: { email: string }) => u.email === 'maria2@example.com');

    const resource = resources[resources.length - 1];
    resource.candidates.startTurn(
      user2.candidateId,
      '51df5f57-df61-4ac2-98af-202608270102',
      {
        messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5848',
        content: 'Сообщение второго кандидата, которое должно остаться.',
        phase: 'discovery',
      },
    );

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${user1.id}`,
      headers: { cookie: adminCookie },
    });
    expect(deleteResponse.statusCode).toBe(200);

    const db = (resource.candidates as unknown as { database: DatabaseSync }).database;
    const cand2 = db
      .prepare('SELECT COUNT(*) AS c FROM candidates WHERE id = ?')
      .get(user2.candidateId) as { c: number };
    expect(cand2.c).toBe(1);

    const msg2 = db
      .prepare('SELECT COUNT(*) AS c FROM messages WHERE candidate_id = ?')
      .get(user2.candidateId) as { c: number };
    expect(msg2.c).toBe(1);
  });

  it('refuses to let administrator delete themselves and preserves data', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const directory = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users?query=${ADMIN.username}`,
      headers: { cookie: adminCookie },
    });
    const adminUser = directory.json().data.users[0];

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${adminUser.id}`,
      headers: { cookie: adminCookie },
    });

    expect(deleteResponse.statusCode).toBe(400);
    expect(deleteResponse.json().error.message).toBe(
      'Администратор не может удалить собственный аккаунт.',
    );

    const resource = resources[resources.length - 1];
    const db = (resource.candidates as unknown as { database: DatabaseSync }).database;
    const adminInDb = db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE id = ?')
      .get(adminUser.id) as { c: number };
    expect(adminInDb.c).toBe(1);
  });
});


