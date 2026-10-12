import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../appTestHarness';
import type { RouteDeps } from './deps';
import { SqliteCandidateDraftRepository } from '../candidate/sqliteCandidateDraftRepository';
import { SqliteCandidateActionRepository } from '../candidate/sqliteCandidateActionRepository';
import { registerCandidateDraftRoutes } from './candidateDraftRoutes';
import { registerNotificationRoutes } from './notificationRoutes';
import { SqliteNotificationRepository } from '../data/sqliteNotificationRepository';

const close: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of close.splice(0)) await fn();
  vi.useRealTimers();
});
async function setup(
  tier = 'pro',
  writer = vi.fn(async () => ({ text: 'Мой опыт.' })),
  memory: readonly Record<string, unknown>[] = [],
  subscriptionPlanId?: string,
) {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates (id) VALUES ('alice'), ('bob');");
  const repository = new SqliteCandidateDraftRepository(db);
  const actionRepository = new SqliteCandidateActionRepository(db);
  const notificationRepository = new SqliteNotificationRepository(db);
  const logs: string[] = [];
  const app = Fastify({
    logger: {
      stream: {
        write: (line: string) => {
          logs.push(line);
        },
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const candidate = { id: 'alice', locale: 'ru-RU', dataClass: 'synthetic', createdAt: '' };
  const getSubscription = vi.fn((_userId: string, _now?: string) =>
    subscriptionPlanId ? { planId: subscriptionPlanId } : null,
  );
  const deps = {
    config,
    candidateStore: {
      authenticate: () => null,
      getSnapshot: () => ({ memory }),
      notificationRepository,
    },
    authService: {
      authenticate: (token: string) => (token === 'session' ? { userId: 'user', candidate } : null),
      getUser: () => ({
        candidateId: 'alice',
        subscriptionTier: tier,
        timezone: 'Asia/Tokyo',
        headline: 'Эксперт',
      }),
    },
    billingRepository: { getSubscription },
    candidateDraftRepository: repository,
    candidateActionRepository: actionRepository,
    linkedinDraftWriter: { writeDraft: writer },
  } as unknown as RouteDeps & {
    candidateDraftRepository: SqliteCandidateDraftRepository;
    linkedinDraftWriter: { writeDraft: typeof writer };
  };
  registerCandidateDraftRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  close.push(async () => {
    await app.close();
    notificationRepository.close();
    db.close();
  });
  const headers = { authorization: 'Bearer session', origin: config.allowedOrigins[0] };
  const post = (
    payload: Record<string, unknown> = { kind: 'comment', topic: 'Опыт' },
    extraHeaders = headers,
  ) =>
    app.inject({ method: 'POST', url: '/api/v1/candidate/drafts', headers: extraHeaders, payload });
  return {
    app,
    post,
    headers,
    repository,
    actionRepository,
    writer,
    logs,
    getSubscription,
  };
}
describe('candidate draft HTTP boundary', () => {
  it('creates an in-app approval notification when a post draft is prepared', async () => {
    const { post, app, headers } = await setup('executive', undefined, [], 'executive');
    const generated = await post({ kind: 'post', topic: 'Запуск продукта' });
    expect(generated.statusCode).toBe(200);
    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications',
      headers,
    });
    expect(inbox.json().data.items.map((item: { kind: string }) => item.kind)).toContain(
      'post_approval',
    );
  });

  it('does not install draft workflow schema when candidate_drafts is absent', async () => {
    const database = new DatabaseSync(':memory:');
    const app = Fastify();
    close.push(async () => {
      await app.close();
      database.close();
    });
    const deps = {
      config,
      candidateStore: {},
      authService: {},
      candidateDraftRepository: {},
      candidateActionRepository: { getDatabase: () => database },
    } as unknown as Parameters<typeof registerCandidateDraftRoutes>[1];

    expect(() => registerCandidateDraftRoutes(app, deps)).not.toThrow();
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'candidate_draft_%'")
        .all(),
    ).toEqual([]);
  });

  it('authenticates and rejects unsafe mutation origins', async () => {
    const { app, post } = await setup();
    expect((await app.inject('/api/v1/candidate/drafts')).statusCode).toBe(401);
    expect(
      (await post(undefined, { authorization: '', origin: 'https://evil.example' })).statusCode,
    ).toBe(403);
  });
  it('uses the server tier, including free and pro post paywalls', async () => {
    const free = await setup('free');
    expect(
      (await free.post({ kind: 'comment', topic: 'Опыт', subscriptionTier: 'enterprise' }))
        .statusCode,
    ).toBe(402);
    const pro = await setup();
    expect((await pro.post({ kind: 'post', topic: 'Опыт' })).statusCode).toBe(402);
    expect(free.writer).not.toHaveBeenCalled();
  });
  it('fails closed when server tier is unknown', async () => {
    const { post } = await setup('unexpected');
    expect((await post()).statusCode).toBe(402);
  });
  it('counts the candidate local day and refuses the fourth pro comment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T18:00:00Z'));
    const { post, repository } = await setup();
    for (let i = 0; i < 3; i++) expect((await post()).statusCode).toBe(200);
    const response = await post();
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('draft_daily_limit');
    expect(repository.countForDay('alice', '2026-09-30', 'comment')).toBe(3);
  });
  it('uses the billing plan for quotas and grants max the executive daily limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T09:30:00Z'));
    const { post, writer, getSubscription } = await setup('free', undefined, [], 'max');

    expect((await post({ kind: 'post', topic: 'Первый черновик' })).statusCode).toBe(200);
    expect((await post({ kind: 'post', topic: 'Второй черновик' })).statusCode).toBe(200);
    const overLimit = await post({ kind: 'post', topic: 'Третий черновик' });

    expect(overLimit.statusCode).toBe(429);
    expect(overLimit.json().error.code).toBe('draft_daily_limit');
    expect(writer).toHaveBeenCalledTimes(2);
    expect(getSubscription).toHaveBeenCalledWith('user', expect.any(String));
  });
  it('serializes concurrent generation so quota cannot be bypassed', async () => {
    const { post, repository } = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => post()));
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(3);
    expect(results.filter((result) => result.statusCode === 429)).toHaveLength(2);
    expect(repository.listRecent('alice')).toHaveLength(3);
  });
  it('returns 503 without saving a draft when the writer fails', async () => {
    const { post, repository, logs } = await setup(
      'pro',
      vi.fn(async () => {
        throw new Error('private provider detail');
      }),
    );
    const response = await post();
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private provider detail');
    expect(logs.join('')).not.toContain('private provider detail');
    expect(repository.listRecent('alice')).toEqual([]);
  });
  it('does not recreate drafts if the candidate deletes their account during generation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'draft-route-deletion-'));
    const databasePath = join(directory, 'store.db');
    const store = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 7) });
    const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const repository = new SqliteCandidateDraftRepository({ databasePath });
    let release: ((value: { text: string }) => void) | undefined;
    let started: (() => void) | undefined;
    const writerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const writerResult = new Promise<{ text: string }>((resolve) => {
      release = resolve;
    });
    const app = Fastify();
    await app.register(cookie);
    const deps = {
      config,
      candidateStore: store,
      candidateDraftRepository: repository,
      authService: {
        authenticate: () => ({ userId: 'user', candidate }),
        getUser: () => ({ subscriptionTier: 'pro', headline: '', timezone: 'Europe/Moscow' }),
      },
      linkedinDraftWriter: {
        writeDraft: async () => {
          started!();
          return writerResult;
        },
      },
    } as unknown as Parameters<typeof registerCandidateDraftRoutes>[1];
    registerCandidateDraftRoutes(app, deps);
    close.push(async () => {
      await app.close();
      repository.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const pending = app.inject({
      method: 'POST',
      url: '/api/v1/candidate/drafts',
      headers: { authorization: 'Bearer session' },
      payload: { kind: 'comment', topic: 'Опыт' },
    });
    void pending.then(() => undefined);
    await writerStarted;
    store.deleteCandidate(candidate.id);
    release!({ text: 'Мой опыт.' });
    expect((await pending).statusCode).toBe(404);
    expect(repository.listRecent(candidate.id)).toEqual([]);
  });
  it('bounds pending generations and rate limits repeated failed model attempts', async () => {
    let release: ((value: { text: string }) => void) | undefined;
    const result = new Promise<{ text: string }>((resolve) => {
      release = resolve;
    });
    const { post } = await setup(
      'pro',
      vi.fn(async () => result),
    );
    const pending = Array.from({ length: 3 }, () => post());
    for (const request of pending) void request.then(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const busyRequest = post();
    void busyRequest.then(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release!({ text: 'Мой опыт.' });
    const busy = await busyRequest;
    expect(busy.statusCode).toBe(429);
    expect(busy.json().error.code).toBe('draft_request_busy');
    await Promise.all(pending);
    const failures = await setup(
      'pro',
      vi.fn(async () => {
        throw new Error('unavailable');
      }),
    );
    for (let i = 0; i < 10; i++) expect((await failures.post()).statusCode).toBe(503);
    expect((await failures.post()).statusCode).toBe(429);
    expect(failures.writer).toHaveBeenCalledTimes(10);
  });
  it('lists own drafts and changes only own status', async () => {
    const { app, post, headers, repository } = await setup();
    const draft = (await post()).json().data;
    expect(
      (await app.inject({ url: '/api/v1/candidate/drafts?limit=20', headers })).json().data,
    ).toHaveLength(1);
    const foreign = repository.create({
      candidateId: 'bob',
      kind: 'post',
      topic: 'Опыт',
      text: 'Чужой.',
      localDate: '2026-09-30',
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/candidate/drafts/${foreign.id}`,
          headers,
          payload: { status: 'copied' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/candidate/drafts/${draft.id}`,
          headers,
          payload: { status: 'copied' },
        })
      ).json().data.status,
    ).toBe('copied');
  });

  it('suggests topics only from candidate-confirmed facts and persists a dismissal', async () => {
    const { app, headers } = await setup('executive', undefined, [
      {
        id: 'fact-confirmed',
        status: 'confirmed',
        statement: 'Сократил выпуск продукта с 14 до 3 дней',
      },
      { id: 'fact-proposed', status: 'proposed', statement: 'Предположение о росте выручки' },
    ]);

    const first = await app.inject({ url: '/api/v1/candidate/drafts/topics?limit=3', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.items).toEqual([
      expect.objectContaining({
        title: 'Сократил выпуск продукта с 14 до 3 дней',
        source: 'Подтверждённый факт профиля',
      }),
    ]);
    const topicId = first.json().data.items[0].id as string;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/candidate/drafts/topics/${topicId}/dismiss`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/candidate/drafts/topics?limit=3', headers })).json().data
        .items,
    ).toEqual([]);
  });

  it('turns a selected topic into a real draft and removes it from available suggestions', async () => {
    const { app, post, headers, writer } = await setup('executive', undefined, [
      { id: 'fact-confirmed', status: 'confirmed', statement: 'Упростил вывод продукта на рынок' },
    ]);
    const topics = (await app.inject({ url: '/api/v1/candidate/drafts/topics', headers })).json()
      .data.items;
    const topic = topics[0];

    expect((await post({ kind: 'post', topic: topic.title, topicId: topic.id })).statusCode).toBe(
      200,
    );
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'post', topic: topic.title }),
    );
    expect(
      (await app.inject({ url: '/api/v1/candidate/drafts/topics', headers })).json().data.items,
    ).toEqual([]);
  });

  it('forwards validated tone, length, and source mode to the draft writer', async () => {
    const { post, writer } = await setup('executive');
    await post({
      kind: 'post',
      topic: 'Запуск продукта',
      sourceText: 'Готовый текст',
      inputType: 'text',
      tone: 'expert',
      length: 'short',
    });
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({
      inputType: 'text', tone: 'expert', length: 'short', sourceText: 'Готовый текст',
    }));
  });

  it('edits, approves, and manually marks a draft published without executing LinkedIn actions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T09:30:00Z'));
    const { app, post, headers, actionRepository } = await setup('executive');
    const draft = (await post({ kind: 'post', topic: 'Как я менял продукт' })).json().data;

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${draft.id}`,
      headers,
      payload: { text: 'Исправленный текст.' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.text).toBe('Исправленный текст.');
    const approved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${draft.id}`,
      headers,
      payload: { status: 'approved' },
    });
    expect(approved.json().data.status).toBe('approved');
    const published = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${draft.id}`,
      headers,
      payload: { status: 'published' },
    });
    expect(published.json().data.status).toBe('published');
    expect(
      (await app.inject({ url: '/api/v1/candidate/drafts?limit=20', headers })).json().data[0]
        .status,
    ).toBe('published');
    expect(actionRepository.listReceipts('alice', 10)).toEqual([]);
  });

  it('requires approval and enforces one manual publication every seven days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T09:30:00Z'));
    const { app, post, headers } = await setup('executive');
    const first = (await post({ kind: 'post', topic: 'Первый пост' })).json().data;
    const unapproved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${first.id}`,
      headers,
      payload: { status: 'published' },
    });
    expect(unapproved.statusCode).toBe(409);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${first.id}`,
      headers,
      payload: { status: 'approved' },
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/candidate/drafts/${first.id}`,
          headers,
          payload: { status: 'published' },
        })
      ).statusCode,
    ).toBe(200);

    const second = (await post({ kind: 'post', topic: 'Второй пост' })).json().data;
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${second.id}`,
      headers,
      payload: { status: 'approved' },
    });
    const tooSoon = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${second.id}`,
      headers,
      payload: { status: 'published' },
    });
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.json().error.code).toBe('draft_cadence_limit');
  });

  it('holds manual publication until a candidate-local B314 window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T09:30:00Z'));
    const { app, post, headers } = await setup('executive');
    const draft = (await post({ kind: 'post', topic: 'Тема поста' })).json().data;
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${draft.id}`,
      headers,
      payload: { status: 'approved' },
    });
    const closedWindow = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/drafts/${draft.id}`,
      headers,
      payload: { status: 'published' },
    });
    expect(closedWindow.statusCode).toBe(409);
    expect(closedWindow.json().error.code).toBe('draft_cadence_limit');
    expect(closedWindow.json().error.message).toContain('2026-10-12T00:00:00.000Z');
  });
});
