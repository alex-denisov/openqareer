import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueDueRaises } from '../candidate/hhRaiseQueue';
import { SqliteHhRaiseRepository } from '../candidate/sqliteHhRaiseRepository';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { createB640Harness } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/hh/raise';
type User = 'flagged.test' | 'other.test' | 'plain.test';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of closers.splice(0)) await close();
});

async function setup(connect: User[] = ['flagged.test']) {
  const harness = await createB640Harness({ pool: () => [] });
  closers.push(harness.close);
  const hh = new SqliteHhSessionRepository({ databasePath: harness.databasePath, encryptionKey: Buffer.alloc(32, 8) });
  for (const user of connect) {
    hh.saveSnapshot(harness.candidateIds[user], { resumes: [{ id: 'abc123', title: 'Инженер' }], selected: null, readAt: '2026-11-19T00:00:00.000Z' });
  }
  hh.close();
  const send = (method: 'PUT' | 'POST', url: string, payload: unknown, user: User) =>
    harness.app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${harness.tokens[user]}` } });
  const raise = new SqliteHhRaiseRepository({ databasePath: harness.databasePath });
  closers.push(async () => raise.close());
  return { ...harness, send, raise };
}

describe('b640 hh raise routes', () => {
  it('answer 404 without a session or the flag', async () => {
    const { get, post } = await setup();
    for (const user of [undefined, 'plain.test' as const]) {
      expect((await get(BASE, user)).statusCode).toBe(404);
      expect((await post(`${BASE}/retry`, {}, user)).statusCode).toBe(404);
      expect((await post(`${BASE}/claim`, {}, user)).statusCode).toBe(404);
    }
  });

  it('is not connected without a read hh snapshot', async () => {
    const { get } = await setup([]);
    expect((await get(BASE, 'flagged.test')).json().data).toMatchObject({ connected: false, resumeId: null, enabled: false, nextRaiseAt: null });
  });

  it('is on by default for a connected hh with a first raise soon', async () => {
    const { get } = await setup();
    const data = (await get(BASE, 'flagged.test')).json().data;
    expect(data).toMatchObject({ connected: true, resumeId: 'abc123', enabled: true, everyHours: 4, lastRaisedAt: null, lastResult: null, pausedUntil: null, pauseReason: null });
    expect(Date.parse(data.nextRaiseAt) - Date.now()).toBeLessThan(30 * 60_000);
  });

  it('turns off and on, scoped to the session candidate', async () => {
    const { get, send } = await setup(['flagged.test', 'other.test']);
    const off = await send('PUT', BASE, { enabled: false }, 'flagged.test');
    expect(off.json().data).toMatchObject({ enabled: false, nextRaiseAt: null });
    expect((await get(BASE, 'other.test')).json().data.enabled).toBe(true);
    expect((await send('PUT', BASE, { enabled: 'yes' }, 'flagged.test')).statusCode).toBe(400);
    expect((await send('PUT', BASE, { enabled: true, resumeId: 'zzz' }, 'flagged.test')).statusCode).toBe(404);
  });

  it('queues only flagged candidates, once per resume, and claims for the session candidate only', async () => {
    const { get, send, raise, candidateIds } = await setup(['flagged.test', 'other.test']);
    await get(BASE, 'flagged.test');
    await get(BASE, 'other.test');
    const later = new Date(Date.now() + 3_600_000);
    const flagged = (id: string) => id === candidateIds['flagged.test'];
    expect(queueDueRaises(raise, later, flagged)).toBe(1);
    expect(queueDueRaises(raise, later, flagged)).toBe(0);
    expect((await send('POST', `${BASE}/claim`, {}, 'other.test')).json().data.task).toBeNull();
    const claimed = (await send('POST', `${BASE}/claim`, {}, 'flagged.test')).json().data.task;
    expect(claimed.resumeId).toBe('abc123');
    expect((await send('POST', `${BASE}/claim`, {}, 'flagged.test')).json().data.task).toBeNull();
  });

  async function claimTask(ctx: Awaited<ReturnType<typeof setup>>) {
    await ctx.get(BASE, 'flagged.test');
    queueDueRaises(ctx.raise, new Date(Date.now() + 3_600_000), () => true);
    return (await ctx.send('POST', `${BASE}/claim`, {}, 'flagged.test')).json().data.task.taskId as string;
  }

  it('records ok: lastRaisedAt set and next raise at least 4 hours away; a result closes once', async () => {
    const ctx = await setup();
    const taskId = await claimTask(ctx);
    const done = await ctx.send('POST', `${BASE}/${taskId}/result`, { outcome: 'ok' }, 'flagged.test');
    const data = done.json().data;
    expect(data.lastResult.status).toBe('ok');
    expect(Date.parse(data.nextRaiseAt) - Date.parse(data.lastRaisedAt)).toBeGreaterThanOrEqual(4 * 3_600_000);
    expect((await ctx.send('POST', `${BASE}/${taskId}/result`, { outcome: 'ok' }, 'flagged.test')).statusCode).toBe(409);
    expect((await ctx.send('POST', `${BASE}/${taskId}/result`, { outcome: 'ok' }, 'other.test')).statusCode).toBe(409);
  });

  it('captcha pauses 24 hours and the scheduler skips it', async () => {
    const ctx = await setup();
    const taskId = await claimTask(ctx);
    const data = (await ctx.send('POST', `${BASE}/${taskId}/result`, { outcome: 'captcha' }, 'flagged.test')).json().data;
    expect(data).toMatchObject({ pauseReason: 'captcha', lastResult: { status: 'error', reason: 'captcha' } });
    expect(Date.parse(data.pausedUntil) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(queueDueRaises(ctx.raise, new Date(Date.now() + 3_600_000), () => true)).toBe(0);
    expect((await ctx.send('POST', `${BASE}/retry`, {}, 'flagged.test')).statusCode).toBe(409);
  });

  it('logged_out pauses until reconnect; turning on again resumes', async () => {
    const ctx = await setup();
    const taskId = await claimTask(ctx);
    await ctx.send('POST', `${BASE}/${taskId}/result`, { outcome: 'logged_out' }, 'flagged.test');
    expect(queueDueRaises(ctx.raise, new Date(Date.now() + 99 * 3_600_000), () => true)).toBe(0);
    expect((await ctx.send('POST', `${BASE}/retry`, {}, 'flagged.test')).json().error.code).toBe('hh_reconnect_required');
    const resumed = (await ctx.send('PUT', BASE, { enabled: true }, 'flagged.test')).json().data;
    expect(resumed.pauseReason).toBeNull();
  });

  it('retry after an error queues a raise now; before 4 hours since a raise it is 409 with the time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:00:00.000Z'));
    const ctx = await setup();
    const taskId = await claimTask(ctx);
    await ctx.send('POST', `${BASE}/${taskId}/result`, { outcome: 'foreign_page' }, 'flagged.test');
    const retried = await ctx.send('POST', `${BASE}/retry`, {}, 'flagged.test');
    expect(retried.statusCode).toBe(200);
    expect((await ctx.send('POST', `${BASE}/claim`, {}, 'flagged.test')).json().data.task).not.toBeNull();
  });

  it('retry before 4 hours after the last raise is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:00:00.000Z'));
    const ctx = await setup();
    ctx.raise.patchSchedule(ctx.candidateIds['flagged.test'], 'abc123', {
      lastRaisedAt: '2026-11-19T08:00:00.000Z', lastResult: 'error', lastReason: 'error', lastResultAt: '2026-11-19T09:00:00.000Z',
    }, '2026-11-19T09:00:00.000Z');
    const response = await ctx.send('POST', `${BASE}/retry`, {}, 'flagged.test');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details.raiseAvailableAt).toBe('2026-11-19T12:00:00.000Z');
  });

  it('leaves the old action tables untouched', async () => {
    const { get, databasePath } = await setup();
    await get(BASE, 'flagged.test');
    const database = new DatabaseSync(databasePath);
    const columns = database.prepare("SELECT name FROM pragma_table_info('candidate_action_daily_usage')").all();
    const rows = database.prepare('SELECT COUNT(*) AS n FROM candidate_action_receipts').get() as { n: number };
    database.close();
    expect(columns).toHaveLength(6);
    expect(rows.n).toBe(0);
    expect((await get('/api/v1/candidate/actions/usage', 'flagged.test')).statusCode).not.toBe(404);
  });
});
