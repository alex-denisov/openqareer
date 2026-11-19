import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const STATE = '/api/v1/candidate/notifications/telegram/state';
const WEBHOOK = '/api/v1/integrations/telegram/webhook';
const SECRET = 'webhook-secret-for-tests';
const TOKEN = 'A'.repeat(43);

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-telegram-state-'));
  const config = { ...baseConfig, databasePath: join(directory, 'test.sqlite'), cabinetB640Usernames: ['flagged.test'], telegramWebhookSecret: SECRET };
  const candidateStore = new SqliteCandidateStore({ databasePath: config.databasePath, encryptionKey: config.dataEncryptionKey });
  const users = new DatabaseSync(config.databasePath);
  const principal = (username: string): AuthPrincipal => {
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    users.prepare(
      `INSERT INTO users (id, username, role, password_salt, password_hash, candidate_id, is_test, created_at, updated_at)
       VALUES (?, ?, 'candidate', 's', 'h', ?, 1, '2026-11-19', '2026-11-19')`,
    ).run(`user-${username}`, username, candidate.id);
    return { userId: `user-${username}`, username, email: null, displayName: null, role: 'candidate', isTest: true, candidate };
  };
  const sessions = new Map([['flagged', principal('flagged.test')], ['plain', principal('plain.test')]]);
  users.close();
  const authService: SessionAuth = { ...noSessions, authenticate: (token: string) => sessions.get(token) ?? null };
  const app = await buildApp({ config, candidateStore, authService, coachProvider: {} as never, serveStatic: false });
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => candidateStore.close(), () => app.close());
  const idOf = (token: string) => sessions.get(token)!.candidate!.id;
  const issue = (token: string, expiresAt: string, code = TOKEN) =>
    candidateStore.notificationRepository.createTelegramLinkCode(
      idOf(token),
      createHash('sha256').update(`openqareer:telegram-link-v1:\0${code}`).digest('hex'),
      expiresAt,
    );
  return { app, issue, databasePath: config.databasePath };
}

const state = (app: App, token?: string) =>
  app.inject({ method: 'GET', url: STATE, headers: token ? { authorization: `Bearer ${token}` } : {} });

const confirm = (app: App, from: unknown) =>
  app.inject({
    method: 'POST', url: WEBHOOK, headers: { 'x-telegram-bot-api-secret-token': SECRET },
    payload: { message: { text: `/start ${TOKEN}`, chat: { id: 777123 }, from } },
  });

describe('B690: состояние привязки Telegram', () => {
  it('goes none → waiting → connected with the name, never giving out the chat id', async () => {
    const { app, issue } = await setup();
    expect((await state(app, 'flagged')).json().data).toEqual({ state: 'none', expiresAt: null, username: null });
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    issue('flagged', expiresAt);
    expect((await state(app, 'flagged')).json().data).toEqual({ state: 'waiting', expiresAt, username: null });
    expect((await confirm(app, { id: 1, username: 'msokolova_dev' })).statusCode).toBe(200);
    const connected = await state(app, 'flagged');
    expect(connected.json().data).toEqual({ state: 'connected', expiresAt: null, username: '@msokolova_dev' });
    expect(connected.body).not.toContain('777123');
  });

  it('says the link went stale after its term', async () => {
    const { app, issue } = await setup();
    issue('flagged', new Date(Date.now() - 1_000).toISOString());
    expect((await state(app, 'flagged')).json().data.state).toBe('expired');
  });

  it('forgets the name on unlink', async () => {
    const { app, issue } = await setup();
    issue('flagged', new Date(Date.now() + 60_000).toISOString());
    await confirm(app, { username: 'msokolova_dev' });
    const unlinked = await app.inject({
      method: 'DELETE', url: '/api/v1/candidate/notifications/telegram/connection',
      headers: { authorization: 'Bearer flagged', origin: 'http://localhost:3000' },
    });
    expect(unlinked.statusCode).toBe(200);
    expect((await state(app, 'flagged')).json().data).toEqual({ state: 'none', expiresAt: null, username: null });
  });

  it('without the flag: the route is 404 and the webhook stores no name', async () => {
    const { app, issue, databasePath } = await setup();
    expect((await state(app, 'plain')).statusCode).toBe(404);
    expect((await state(app)).statusCode).toBe(404);
    issue('plain', new Date(Date.now() + 60_000).toISOString());
    expect((await confirm(app, { username: 'plain_person' })).json()).toEqual({ ok: true });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE name = 'candidate_telegram_usernames'").all();
    database.close();
    expect(tables).toEqual([]);
  });

  it('a strange sender shape still links the chat, just without a name', async () => {
    const { app, issue } = await setup();
    issue('flagged', new Date(Date.now() + 60_000).toISOString());
    expect((await confirm(app, 'not-an-object')).statusCode).toBe(200);
    expect((await state(app, 'flagged')).json().data).toEqual({ state: 'connected', expiresAt: null, username: null });
  });
});
