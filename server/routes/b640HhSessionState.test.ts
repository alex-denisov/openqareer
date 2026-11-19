import { afterEach, describe, expect, it } from 'vitest';
import { queueDueRaises } from '../candidate/hhRaiseQueue';
import { SqliteHhRaiseRepository } from '../candidate/sqliteHhRaiseRepository';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { SqliteNotificationRepository } from '../data/sqliteNotificationRepository';
import { createB640Harness } from '../testHelpers/b640VacancyHarness';

const RAISE = '/api/v1/candidate/b640/hh/raise';
const SESSION = '/api/v1/candidate/b640/hh/session';
const KEY = Buffer.alloc(32, 8);
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const RESUMES = [{ id: 'abc123', title: 'Инженер' }, { id: 'def456', title: 'Руководитель' }];

async function setup() {
  const harness = await createB640Harness({ pool: () => [] });
  closers.push(harness.close);
  const hh = new SqliteHhSessionRepository({ databasePath: harness.databasePath, encryptionKey: KEY });
  hh.saveSnapshot(harness.candidateIds['flagged.test'], { resumes: RESUMES, selected: null, readAt: '2026-11-19T00:00:00.000Z' });
  hh.close();
  const raise = new SqliteHhRaiseRepository({ databasePath: harness.databasePath });
  const notes = new SqliteNotificationRepository({ databasePath: harness.databasePath });
  closers.push(async () => { raise.close(); notes.close(); });
  const send = (method: 'PUT' | 'POST', url: string, payload: unknown) =>
    harness.app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${harness.tokens['flagged.test']}` } });
  const candidateId = harness.candidateIds['flagged.test'];
  const unread = () => notes.list(candidateId, { limit: 20, now: new Date().toISOString() }).items.filter((item) => item.readAt === null);
  async function raiseWith(outcome: string, resumeId = 'abc123') {
    await harness.get(`${RAISE}?resumeId=${resumeId}`, 'flagged.test');
    queueDueRaises(raise, new Date(Date.now() + 3_600_000), () => true);
    const task = (await send('POST', `${RAISE}/claim`, {})).json().data.task;
    return send('POST', `${RAISE}/${task.taskId}/result`, { outcome });
  }
  return { ...harness, send, unread, raiseWith };
}

describe('B690: вход в hh.ru истёк', () => {
  it('answers 404 without a session or the flag', async () => {
    const { get } = await setup();
    expect((await get(SESSION)).statusCode).toBe(404);
    expect((await get(SESSION, 'plain.test')).statusCode).toBe(404);
  });

  it('is not expired until a raise meets the hh login page', async () => {
    const ctx = await setup();
    expect((await ctx.get(SESSION, 'flagged.test')).json().data).toEqual({ expired: false, since: null });
    await ctx.raiseWith('ok');
    expect((await ctx.get(SESSION, 'flagged.test')).json().data.expired).toBe(false);
    expect(ctx.unread()).toHaveLength(0);
  });

  it('logged_out marks the session expired and leaves one unread notice that leads to n03', async () => {
    const ctx = await setup();
    await ctx.raiseWith('logged_out');
    const state = (await ctx.get(SESSION, 'flagged.test')).json().data;
    expect(state.expired).toBe(true);
    expect(typeof state.since).toBe('string');
    const [notice, ...rest] = ctx.unread();
    expect(rest).toHaveLength(0);
    expect(notice).toMatchObject({
      kind: 'delivery_error',
      title: 'Вход в hh.ru истёк',
      source: 'hh_session',
      action: { label: 'Войти снова', href: '/app/account/connections' },
    });
  });

  it('does not repeat the notice while the session stays expired', async () => {
    const ctx = await setup();
    await ctx.raiseWith('logged_out');
    await ctx.raiseWith('logged_out', 'def456');
    expect(ctx.unread()).toHaveLength(1);
  });

  it('a fresh hh login clears the state and removes the unread notice', async () => {
    const ctx = await setup();
    await ctx.raiseWith('logged_out');
    const relogin = await ctx.send('PUT', '/api/v1/candidate/hh/resumes', { resumes: RESUMES, selected: null });
    expect(relogin.statusCode).toBe(200);
    expect((await ctx.get(SESSION, 'flagged.test')).json().data).toEqual({ expired: false, since: null });
    expect(ctx.unread()).toHaveLength(0);
  });

  it('a successful raise also removes the unread notice', async () => {
    const ctx = await setup();
    await ctx.raiseWith('logged_out');
    await ctx.send('PUT', RAISE, { enabled: true, resumeId: 'def456' });
    await ctx.raiseWith('ok', 'def456');
    expect(ctx.unread()).toHaveLength(0);
  });
});
