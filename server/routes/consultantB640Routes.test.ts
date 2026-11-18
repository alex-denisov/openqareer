import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { output, turnRequest } from '../data/sqliteTestHarness';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/candidate/consultant';
const KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const flagged = 'token-flagged';
const plain = 'token-plain';
const intruder = 'token-intruder';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-consultant-b640-'));
  const config = { ...baseConfig, databasePath: join(directory, 'test.sqlite'), cabinetB640Usernames: ['flagged.test', 'intruder.test'] };
  const store = new SqliteCandidateStore({ databasePath: config.databasePath, encryptionKey: config.dataEncryptionKey });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const sessions = new Map([
    [flagged, principal('flagged.test')],
    [plain, principal('plain.test')],
    [intruder, principal('intruder.test')],
  ]);
  const authService: SessionAuth = { ...noSessions, authenticate: (token: string) => sessions.get(token) ?? null };
  const app = await buildApp({ config, candidateStore: store, authService, coachProvider: {} as never, serveStatic: false });
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => store.close(), () => app.close());
  const candidateOf = (token: string) => sessions.get(token)!.candidate!.id;
  const ask = (token: string) => {
    const started = store.startTurn(candidateOf(token), KEY, { ...turnRequest, stage: 'today' });
    if (started.state !== 'ready') throw new Error('expected a ready turn');
    store.completeTurn(candidateOf(token), KEY, output);
  };
  return { app, store, candidateOf, ask };
}

function call(app: App, method: 'GET' | 'POST', url: string, token?: string) {
  return app.inject({ method, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN } });
}

const NEW_ROUTES: ReadonlyArray<['GET' | 'POST', string]> = [
  ['GET', `${BASE}/current?stage=today`],
  ['POST', `${BASE}/current/close`],
  ['POST', `${BASE}/conversations/cccccccc-cccc-4ccc-8ccc-cccccccccccc/resume`],
  ['POST', `${BASE}/facts/some-memory/confirm`],
];

describe('consultant B640 routes without the flag', () => {
  it('answer like a missing address and write nothing', async () => {
    const { app, store, candidateOf, ask } = await setup();
    ask(plain);
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const [method, url] of NEW_ROUTES) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
    const fact = store.getSnapshot(candidateOf(plain)).memory[0]!;
    await call(app, 'POST', `${BASE}/facts/${fact.id}/confirm`, plain);
    expect(store.getSnapshot(candidateOf(plain)).memory[0]!.status).toBe('proposed');
    expect(store.listConsultantConversations(candidateOf(plain)).items).toEqual([]);
  });
});

describe('consultant B640 routes with the flag', () => {
  it('closes the current conversation and continues it from the history', async () => {
    const { app, ask } = await setup();
    ask(flagged);
    const current = await call(app, 'GET', `${BASE}/current?stage=today`, flagged);
    const conversationId = current.json().data.id as string;
    expect(current.json().data.messages).toHaveLength(2);

    expect((await call(app, 'POST', `${BASE}/current/close`, flagged)).json().data).toEqual({ closedId: conversationId });
    expect((await call(app, 'GET', `${BASE}/current?stage=today`, flagged)).json().data).toBeNull();

    const foreign = await call(app, 'POST', `${BASE}/conversations/${conversationId}/resume`, intruder);
    expect(foreign.statusCode).toBe(404);
    const resumed = await call(app, 'POST', `${BASE}/conversations/${conversationId}/resume`, flagged);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().data).toMatchObject({ id: conversationId, closedAt: null });
    expect((await call(app, 'GET', `${BASE}/current?stage=profile`, flagged)).json().data.id).toBe(conversationId);
  });

  it('rejects a bad stage, a bad conversation id and an empty close', async () => {
    const { app } = await setup();
    expect((await call(app, 'GET', `${BASE}/current?stage=nowhere`, flagged)).statusCode).toBe(400);
    expect((await call(app, 'POST', `${BASE}/conversations/not-a-uuid/resume`, flagged)).statusCode).toBe(400);
    expect((await call(app, 'POST', `${BASE}/current/close`, flagged)).json().data).toEqual({ closedId: null });
  });

  it('«Верно» confirms only the candidate’s own proposed fact, and the history returns it', async () => {
    const { app, store, candidateOf, ask } = await setup();
    ask(flagged);
    const fact = store.getSnapshot(candidateOf(flagged)).memory[0]!;
    expect(fact.status).toBe('proposed');

    expect((await call(app, 'POST', `${BASE}/facts/${fact.id}/confirm`, intruder)).statusCode).toBe(404);
    const confirmed = await call(app, 'POST', `${BASE}/facts/${fact.id}/confirm`, flagged);
    expect(confirmed.statusCode).toBe(200);
    expect(store.getSnapshot(candidateOf(flagged)).memory[0]).toMatchObject({ status: 'confirmed', confidence: 'candidate-confirmed' });
    expect((await call(app, 'POST', `${BASE}/facts/${fact.id}/confirm`, flagged)).statusCode).toBe(409);

    const history = (await call(app, 'GET', '/api/v1/candidate/profile/history', flagged)).json().data.entries;
    expect(history[0]).toMatchObject({ id: confirmed.json().data.changeId, kind: 'confirmation', label: fact.statement });
    const revert = await call(app, 'POST', `/api/v1/candidate/profile/history/${history[0].id}/revert`, flagged);
    expect(revert.statusCode).toBeLessThan(300);
    expect(store.getSnapshot(candidateOf(flagged)).memory[0]).toMatchObject({ status: 'proposed', confidence: fact.confidence });
  });
});
