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
import { registerCandidateDraftRoutes } from './candidateDraftRoutes';

const close: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of close.splice(0)) await fn(); vi.useRealTimers(); });
async function setup(tier = 'pro', writer = vi.fn(async () => ({ text: 'Мой опыт.' }))) {
  const db = new DatabaseSync(':memory:');
  const repository = new SqliteCandidateDraftRepository(db);
  const logs: string[] = [];
  const app = Fastify({ logger: { stream: { write: (line: string) => { logs.push(line); } } } });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const candidate = { id: 'alice', locale: 'ru-RU', dataClass: 'synthetic', createdAt: '' };
  const deps = { config, candidateStore: { authenticate: () => null, getSnapshot: () => ({ memory: [] }) },
    authService: { authenticate: (token: string) => token === 'session' ? { userId: 'user', candidate } : null,
      getUser: () => ({ candidateId: 'alice', subscriptionTier: tier, timezone: 'Asia/Tokyo', headline: 'Эксперт' }) },
    candidateDraftRepository: repository, linkedinDraftWriter: { writeDraft: writer },
  } as unknown as RouteDeps & { candidateDraftRepository: SqliteCandidateDraftRepository; linkedinDraftWriter: { writeDraft: typeof writer } };
  registerCandidateDraftRoutes(app, deps);
  close.push(async () => { await app.close(); db.close(); });
  const headers = { authorization: 'Bearer session', origin: config.allowedOrigins[0] };
  const post = (payload: Record<string, unknown> = { kind: 'comment', topic: 'Опыт' }, extraHeaders = headers) => app.inject({ method: 'POST', url: '/api/v1/candidate/drafts', headers: extraHeaders, payload });
  return { app, post, headers, repository, writer, logs };
}
describe('candidate draft HTTP boundary', () => {
  it('authenticates and rejects unsafe mutation origins', async () => {
    const { app, post } = await setup();
    expect((await app.inject('/api/v1/candidate/drafts')).statusCode).toBe(401);
    expect((await post(undefined, { authorization: '', origin: 'https://evil.example' })).statusCode).toBe(403);
  });
  it('uses the server tier, including free and pro post paywalls', async () => {
    const free = await setup('free');
    expect((await free.post({ kind: 'comment', topic: 'Опыт', subscriptionTier: 'enterprise' })).statusCode).toBe(402);
    const pro = await setup();
    expect((await pro.post({ kind: 'post', topic: 'Опыт' })).statusCode).toBe(402);
    expect(free.writer).not.toHaveBeenCalled();
  });
  it('fails closed when server tier is unknown', async () => {
    const { post } = await setup('unexpected');
    expect((await post()).statusCode).toBe(402);
  });
  it('counts the candidate local day and refuses the fourth pro comment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T18:00:00Z'));
    const { post, repository } = await setup();
    for (let i = 0; i < 3; i++) expect((await post()).statusCode).toBe(200);
    const response = await post();
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('draft_daily_limit');
    expect(repository.countForDay('alice', '2026-09-30', 'comment')).toBe(3);
  });
  it('serializes concurrent generation so quota cannot be bypassed', async () => {
    const { post, repository } = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => post()));
    expect(results.filter(result => result.statusCode === 200)).toHaveLength(3);
    expect(results.filter(result => result.statusCode === 429)).toHaveLength(2);
    expect(repository.listRecent('alice')).toHaveLength(3);
  });
  it('returns 503 without saving a draft when the writer fails', async () => {
    const { post, repository, logs } = await setup('pro', vi.fn(async () => { throw new Error('private provider detail'); }));
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
    const writerStarted = new Promise<void>(resolve => { started = resolve; });
    const writerResult = new Promise<{ text: string }>(resolve => { release = resolve; });
    const app = Fastify(); await app.register(cookie);
    const deps = { config, candidateStore: store, candidateDraftRepository: repository,
      authService: { authenticate: () => ({ userId: 'user', candidate }),
        getUser: () => ({ subscriptionTier: 'pro', headline: '', timezone: 'Europe/Moscow' }) },
      linkedinDraftWriter: { writeDraft: async () => { started!(); return writerResult; } },
    } as unknown as Parameters<typeof registerCandidateDraftRoutes>[1];
    registerCandidateDraftRoutes(app, deps);
    close.push(async () => { await app.close(); repository.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
    const pending = app.inject({ method: 'POST', url: '/api/v1/candidate/drafts', headers: { authorization: 'Bearer session' }, payload: { kind: 'comment', topic: 'Опыт' } });
    void pending.then(() => undefined);
    await writerStarted;
    store.deleteCandidate(candidate.id);
    release!({ text: 'Мой опыт.' });
    expect((await pending).statusCode).toBe(404);
    expect(repository.listRecent(candidate.id)).toEqual([]);
  });
  it('bounds pending generations and rate limits repeated failed model attempts', async () => {
    let release: ((value: { text: string }) => void) | undefined;
    const result = new Promise<{ text: string }>(resolve => { release = resolve; });
    const { post } = await setup('pro', vi.fn(async () => result));
    const pending = Array.from({ length: 3 }, () => post());
    for (const request of pending) void request.then(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 20));
    const busyRequest = post();
    void busyRequest.then(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 20));
    release!({ text: 'Мой опыт.' });
    const busy = await busyRequest;
    expect(busy.statusCode).toBe(429);
    expect(busy.json().error.code).toBe('draft_request_busy');
    await Promise.all(pending);
    const failures = await setup('pro', vi.fn(async () => { throw new Error('unavailable'); }));
    for (let i = 0; i < 10; i++) expect((await failures.post()).statusCode).toBe(503);
    expect((await failures.post()).statusCode).toBe(429);
    expect(failures.writer).toHaveBeenCalledTimes(10);
  });
  it('lists own drafts and changes only own status', async () => {
    const { app, post, headers, repository } = await setup();
    const draft = (await post()).json().data;
    expect((await app.inject({ url: '/api/v1/candidate/drafts?limit=20', headers })).json().data).toHaveLength(1);
    const foreign = repository.create({ candidateId: 'bob', kind: 'post', topic: 'Опыт', text: 'Чужой.', localDate: '2026-09-30' });
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/candidate/drafts/${foreign.id}`, headers, payload: { status: 'copied' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/candidate/drafts/${draft.id}`, headers, payload: { status: 'copied' } })).json().data.status).toBe('copied');
  });
});
