import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import { AuthService } from './auth/authService';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './vacancies/memoryVacancyPoolStore';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

const provider: CoachProvider = {
  async createTurn() {
    throw new Error('executive request routes must not call a language model');
  },
};

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});

async function createApp(
  options: { executiveRequestCapacity?: number; notifyTeam?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-executive-requests-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts(
    [
      { username: 'candidate.executive', password: 'candidate-executive-password', role: 'candidate' },
      { username: 'candidate.second', password: 'candidate-second-password', role: 'candidate' },
      { username: 'admin.executive', password: 'admin-executive-password', role: 'admin' },
    ],
    candidates,
  );
  const poolStore = new MemoryVacancyPoolStore();
  const multiSourceEngine = new MultiSourceVacancyEngine({
    pool: poolStore,
    recluster: { mode: 'sync' },
  });
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'not-used',
    openRouterKey: 'not-used',
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
    executiveRequestCapacity: options.executiveRequestCapacity ?? 0,
    ...(options.notifyTeam
      ? {
          telegramBotToken: '12345:' + 'A'.repeat(36),
          telegramOwnerChatId: '123456',
        }
      : {}),
  };
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    multiSourceVacancyEngine: multiSourceEngine,
    serveStatic: false,
  });
  resources.push({ app, auth, candidates, directory });
  return app;
}

async function login(
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

describe('Executive request API (B471)', () => {
  it('requires candidate auth, a safe origin, an idempotency key and bounded task details', async () => {
    const app = await createApp();
    const payload = {
      task: 'Найти позицию директора по продукту в технологической компании',
      timeline: 'В течение трёх месяцев',
    };
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers: { origin: 'http://localhost:3000' },
      payload,
    });
    expect(anonymous.statusCode).toBe(401);

    const cookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });
    const headers = { origin: 'http://localhost:3000', cookie };
    const missingKey = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers,
      payload,
    });
    const invalidTask = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers: {
        ...headers,
        'idempotency-key': 'ed3a7bb2-40a5-4f89-8b8c-32fb61ee7aac',
      },
      payload: { ...payload, task: 'коротко' },
    });
    const foreignOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers: {
        origin: 'https://evil.example',
        cookie,
        'idempotency-key': '147d7582-561a-4cf7-920d-5fbfcb33548a',
      },
      payload,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(invalidTask.statusCode).toBe(400);
    expect(foreignOrigin.statusCode).toBe(403);
  });

  it('persists a bounded request and places it on the waitlist when capacity is closed', async () => {
    const app = await createApp();
    const cookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers: {
        origin: 'http://localhost:3000',
        cookie,
        'idempotency-key': '6a8a2d4e-f742-4b88-bc2d-1e9ef9dd4321',
      },
      payload: {
        task: 'Найти позицию операционного директора в технологической компании',
        timeline: 'В течение трёх месяцев',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      task: 'Найти позицию операционного директора в технологической компании',
      timeline: 'В течение трёх месяцев',
      status: 'waitlisted',
    });
    expect(response.headers.location).toMatch(/^\/api\/v1\/candidate\/executive-requests\//u);
    const requestPath = String(response.headers.location);
    const ownRead = await app.inject({ method: 'GET', url: requestPath, headers: { cookie } });
    expect(ownRead.statusCode).toBe(200);
    expect(ownRead.json().data.id).toBe(response.json().data.id);
    const exported = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/export',
      headers: { cookie },
    });
    expect(exported.json().data.executiveRequests).toMatchObject([
      { id: response.json().data.id, task: response.json().data.task },
    ]);
    const otherCookie = await login(app, {
      username: 'candidate.second',
      password: 'candidate-second-password',
    });
    const foreignRead = await app.inject({
      method: 'GET',
      url: requestPath,
      headers: { cookie: otherCookie },
    });
    expect(foreignRead.statusCode).toBe(404);
  });

  it('returns the same request for an idempotent retry and rejects key reuse with new content', async () => {
    const app = await createApp();
    const cookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });
    const headers = {
      origin: 'http://localhost:3000',
      cookie,
      'idempotency-key': '6a8a2d4e-f742-4b88-bc2d-1e9ef9dd4321',
    };
    const payload = {
      task: 'Найти позицию операционного директора в технологической компании',
      timeline: 'В течение трёх месяцев',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers,
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json().data.id).toBe(first.json().data.id);

    const duplicateWithNewKey = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers: {
        ...headers,
        'idempotency-key': '1aef521c-cc15-4e2e-8f60-8c189f2f2e75',
      },
      payload,
    });
    expect(duplicateWithNewKey.statusCode).toBe(200);
    expect(duplicateWithNewKey.json().data.id).toBe(first.json().data.id);
    expect(duplicateWithNewKey.headers['idempotency-replayed']).toBeUndefined();

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers,
      payload: { ...payload, timeline: 'Начать немедленно' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('executive_request_idempotency_conflict');
  });

  it('uses available capacity once, then places later requests on the waitlist', async () => {
    const app = await createApp({ executiveRequestCapacity: 1 });
    const firstCookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });
    const secondCookie = await login(app, {
      username: 'candidate.second',
      password: 'candidate-second-password',
    });
    const submit = (cookie: string, key: string, task: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/candidate/executive-requests',
        headers: {
          origin: 'http://localhost:3000',
          cookie,
          'idempotency-key': key,
        },
        payload: { task, timeline: 'В течение трёх месяцев' },
      });

    const first = await submit(
      firstCookie,
      '59ff73f9-30f6-4f57-bb03-ccce8c5cc551',
      'Найти позицию директора по продукту в технологической компании',
    );
    const second = await submit(
      secondCookie,
      'a62db222-89b8-4cda-98c0-b2ad8f42ef3c',
      'Найти позицию директора по маркетингу в технологической компании',
    );
    expect(first.json().data.status).toBe('submitted');
    expect(second.json().data.status).toBe('waitlisted');
  });

  it('limits each candidate to three new requests per hour', async () => {
    const app = await createApp();
    const cookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });
    const submit = (key: string, suffix: number) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/candidate/executive-requests',
        headers: {
          origin: 'http://localhost:3000',
          cookie,
          'idempotency-key': key,
        },
        payload: {
          task: 'Найти позицию руководителя направления номер ' + suffix,
          timeline: 'В течение трёх месяцев',
        },
      });
    await submit('c5e02985-947b-42c9-9bda-5992003fe00b', 1);
    await submit('1aed8e81-4bcf-4497-9899-aa44546ff8ac', 2);
    await submit('1b1b067d-448b-4c21-a7f9-49ec8af46dbd', 3);
    const limited = await submit('a9514147-c01a-4580-80ca-c52c80ed3aa9', 4);

    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(3_600);
    expect(limited.json().error.code).toBe('executive_request_rate_limited');
  });

  it('keeps request status candidate-scoped and lets only administrators update it', async () => {
    const app = await createApp({ executiveRequestCapacity: 1 });
    const candidateCookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });
    const adminCookie = await login(app, {
      username: 'admin.executive',
      password: 'admin-executive-password',
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers: {
        origin: 'http://localhost:3000',
        cookie: candidateCookie,
        'idempotency-key': '75977b39-a9e8-4662-a9ec-b39365e915bc',
      },
      payload: {
        task: 'Найти позицию коммерческого директора в технологической компании',
        timeline: 'В течение трёх месяцев',
      },
    });
    const requestId = created.json().data.id as string;
    const secondCookie = await login(app, {
      username: 'candidate.second',
      password: 'candidate-second-password',
    });
    const waitlisted = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers: {
        origin: 'http://localhost:3000',
        cookie: secondCookie,
        'idempotency-key': '86dbacfa-a395-4b28-871c-8c3a5d4c1ef1',
      },
      payload: {
        task: 'Найти позицию директора по развитию в технологической компании',
        timeline: 'В течение шести месяцев',
      },
    });
    const waitlistedId = waitlisted.json().data.id as string;
    expect(waitlisted.json().data.status).toBe('waitlisted');

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/executive-requests',
    });
    const candidateAccess = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/executive-requests',
      headers: { cookie: candidateCookie },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(candidateAccess.statusCode).toBe(403);

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/executive-requests?limit=10',
      headers: { cookie: adminCookie },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.items).toHaveLength(2);
    expect(queue.json().data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: requestId, candidateId: expect.any(String), status: 'submitted' }),
        expect.objectContaining({ id: waitlistedId, status: 'waitlisted' }),
      ]),
    );

    const full = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/executive-requests/' + waitlistedId,
      headers: { origin: 'http://localhost:3000', cookie: adminCookie },
      payload: { status: 'in_review' },
    });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('executive_request_capacity_reached');
    const unsafeOrigin = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/executive-requests/' + waitlistedId,
      headers: { origin: 'https://evil.example', cookie: adminCookie },
      payload: { status: 'in_review' },
    });
    expect(unsafeOrigin.statusCode).toBe(403);

    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/executive-requests/' + requestId,
      headers: { origin: 'http://localhost:3000', cookie: adminCookie },
      payload: { status: 'in_review' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.status).toBe('in_review');

    const candidateView = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/executive-requests?limit=10',
      headers: { cookie: candidateCookie },
    });
    expect(candidateView.json().data.items).toMatchObject([{ id: requestId, status: 'in_review' }]);
    expect(candidateView.json().data.items[0]).not.toHaveProperty('candidateId');
  });

  it('paginates the team queue with a stable cursor', async () => {
    const app = await createApp();
    const firstCookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });
    const secondCookie = await login(app, {
      username: 'candidate.second',
      password: 'candidate-second-password',
    });
    const adminCookie = await login(app, {
      username: 'admin.executive',
      password: 'admin-executive-password',
    });
    const submit = (cookie: string, key: string, suffix: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/candidate/executive-requests',
        headers: { origin: 'http://localhost:3000', cookie, 'idempotency-key': key },
        payload: {
          task: 'Найти позицию руководителя направления ' + suffix,
          timeline: 'В течение трёх месяцев',
        },
      });
    await submit(firstCookie, '8f8cd63c-d4f5-47c4-8cd4-984c538ce6fb', 'продукта');
    await submit(secondCookie, '9c6d1a99-c934-4e16-8935-0c8c4a5dc40a', 'маркетинга');

    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/executive-requests?limit=1',
      headers: { cookie: adminCookie },
    });
    const cursor = firstPage.json().data.nextCursor as string;
    expect(firstPage.json().data.items).toHaveLength(1);
    expect(cursor).toBeTruthy();
    const nextPage = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/executive-requests?limit=1&cursor=' + encodeURIComponent(cursor),
      headers: { cookie: adminCookie },
    });
    expect(nextPage.json().data.items).toHaveLength(1);
    expect(nextPage.json().data.nextCursor).toBeNull();
    expect(nextPage.json().data.items[0].id).not.toBe(firstPage.json().data.items[0].id);
  });

  it('notifies the configured team channel once after a new request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await createApp({ notifyTeam: true });
    const cookie = await login(app, {
      username: 'candidate.executive',
      password: 'candidate-executive-password',
    });
    const headers = {
      origin: 'http://localhost:3000',
      cookie,
      'idempotency-key': 'e5acee1a-4a40-462c-8e59-169002ef09d7',
    };
    const payload = {
      task: 'Найти позицию директора по стратегии в технологической компании',
      timeline: 'В течение трёх месяцев',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers,
      payload,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/executive-requests',
      headers,
      payload,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      text: string;
    };
    expect(requestBody.text).toContain(created.json().data.id);
    expect(requestBody.text).not.toContain(payload.task);
    expect(requestBody.text).not.toContain(payload.timeline);
    expect(requestBody.text).not.toContain('candidate.executive');
  });
});
