import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';
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

  it('reports an open task until its result and treats too_early as no error', async () => {
    const ctx = await setup();
    const taskId = await claimTask(ctx);
    expect((await ctx.get(BASE, 'flagged.test')).json().data.pending).toBe(true);
    const url = `${BASE}/${taskId}/result`;
    for (const availableAt of ['24:00', '9:05', '20:55 ', 2055]) {
      expect((await ctx.send('POST', url, { outcome: 'too_early', availableAt }, 'flagged.test')).statusCode).toBe(400);
    }
    const data = (await ctx.send('POST', url, { outcome: 'too_early', availableAt: '20:55' }, 'flagged.test')).json().data;
    expect(data).toMatchObject({ pending: false, lastResult: { status: 'ok', reason: 'too_early' } });
    expect(data.nextRaiseAt).toContain(':57:00.000Z');
  });

  it('turning off drops a queued task, and claim never hands out one of a disabled resume', async () => {
    const ctx = await setup();
    const candidateId = ctx.candidateIds['flagged.test'];
    const claim = async () => (await ctx.send('POST', `${BASE}/claim`, {}, 'flagged.test')).json().data.task;
    await ctx.get(BASE, 'flagged.test');
    ctx.raise.enqueue(candidateId, 'abc123', new Date().toISOString());
    const off = (await ctx.send('PUT', BASE, { enabled: false }, 'flagged.test')).json().data;
    expect(off).toMatchObject({ enabled: false, pending: false });
    await ctx.send('PUT', BASE, { enabled: true }, 'flagged.test');
    expect(await claim()).toBeNull();

    ctx.raise.enqueue(candidateId, 'abc123', new Date().toISOString());
    ctx.raise.patchSchedule(candidateId, 'abc123', { enabled: false }, new Date().toISOString());
    expect(await claim()).toBeNull();
    ctx.raise.patchSchedule(candidateId, 'abc123', { enabled: true }, new Date().toISOString());
    expect(await claim()).not.toBeNull();
  });

  it.each([null, 'actions_on_behalf-v1.0'])('B787: does not need the apply mandate (consent: %s)', async (versionId) => {
    const { get, send, raise, candidateIds, databasePath } = await setup();
    if (versionId) {
      const consents = new SqliteCapabilityConsentStore({ databasePath });
      consents.recordConsent({ userId: candidateIds['flagged.test'], capability: 'actions_on_behalf', versionId });
      consents.close();
    }
    await get(BASE, 'flagged.test');
    expect(queueDueRaises(raise, new Date(Date.now() + 3_600_000), () => true)).toBe(1);
    expect((await send('POST', `${BASE}/claim`, {}, 'flagged.test')).json().data.task.resumeId).toBe('abc123');
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
    expect(retried.json().data.pending).toBe(true);
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

  describe('выбор резюме для автоподнятия (a11)', () => {
    const FLAGGED = 'flagged.test';
    async function twoResumes() {
      const ctx = await setup();
      const hh = new SqliteHhSessionRepository({ databasePath: ctx.databasePath, encryptionKey: Buffer.alloc(32, 8) });
      const save = (ids: string[]) =>
        hh.saveSnapshot(ctx.candidateIds[FLAGGED], {
          resumes: ids.map((id) => ({ id, title: `Резюме ${id}`, updatedLabel: 'обновлено 3 ноября' })), selected: null, readAt: '2026-11-19T00:00:00.000Z',
        });
      closers.push(async () => hh.close());
      save(['abc123', 'def456']);
      const state = async () => (await ctx.get(BASE, FLAGGED)).json().data;
      const choose = (resumeId: string, enabled = true) => ctx.send('PUT', BASE, { enabled, resumeId }, FLAGGED);
      return { ...ctx, save, state, choose };
    }

    it('lists the resumes and keeps the chosen one', async () => {
      const { state, choose } = await twoResumes();
      expect((await state()).resumes).toEqual([
        { id: 'abc123', title: 'Резюме abc123', updatedLabel: 'обновлено 3 ноября' },
        { id: 'def456', title: 'Резюме def456', updatedLabel: 'обновлено 3 ноября' },
      ]);
      expect((await choose('def456')).json().data).toMatchObject({ resumeId: 'def456', enabled: true });
      expect(await state()).toMatchObject({ resumeId: 'def456', enabled: true });
    });

    it('raises only the chosen resume, dropping a queued raise of the former', async () => {
      const { state, choose, raise, send } = await twoResumes();
      await state();
      const later = new Date(Date.now() + 3_600_000);
      expect(queueDueRaises(raise, later, () => true)).toBe(1);
      await choose('def456');
      expect(queueDueRaises(raise, later, () => true)).toBe(1);
      const claim = async () => (await send('POST', `${BASE}/claim`, {}, FLAGGED)).json().data.task;
      expect((await claim()).resumeId).toBe('def456');
      expect(await claim()).toBeNull();
    });

    it('keeps the 4 hours of a resume raised before', async () => {
      const { state, choose, raise, candidateIds } = await twoResumes();
      await state();
      const raisedAt = new Date().toISOString();
      raise.patchSchedule(candidateIds[FLAGGED], 'def456', { lastRaisedAt: raisedAt, nextRaiseAt: null }, raisedAt);
      const { nextRaiseAt } = (await choose('def456')).json().data;
      expect(Date.parse(nextRaiseAt) - Date.parse(raisedAt)).toBeGreaterThanOrEqual(4 * 3_600_000);
    });

    it('carries the hh pause over, so switching does not bypass a captcha', async () => {
      const { state, choose, raise, candidateIds } = await twoResumes();
      await state();
      const until = new Date(Date.now() + 20 * 3_600_000).toISOString();
      raise.patchSchedule(candidateIds[FLAGGED], 'abc123', { pauseReason: 'captcha', pausedUntil: until }, until);
      expect((await choose('def456')).json().data).toMatchObject({ pauseReason: 'captcha', pausedUntil: until });
      expect(queueDueRaises(raise, new Date(Date.now() + 3_600_000), () => true)).toBe(0);
    });

    it('a switched-off raise stays off after choosing', async () => {
      const { state, choose, raise } = await twoResumes();
      await choose('abc123', false);
      await choose('def456', false);
      expect(await state()).toMatchObject({ resumeId: 'def456', enabled: false });
      expect(queueDueRaises(raise, new Date(Date.now() + 3_600_000), () => true)).toBe(0);
    });

    it('a chosen resume gone from hh.ru gives way to the first one', async () => {
      const { save, state, choose, raise } = await twoResumes();
      await choose('def456');
      save(['abc123']);
      expect(await state()).toMatchObject({ resumeId: 'abc123', enabled: true });
      expect(queueDueRaises(raise, new Date(Date.now() + 3_600_000), () => true)).toBe(1);
    });

    it('does not retry a resume that is not chosen', async () => {
      const { choose, send, raise, candidateIds } = await twoResumes();
      const now = new Date().toISOString();
      raise.patchSchedule(candidateIds[FLAGGED], 'abc123', { lastResult: 'error', lastReason: 'error', lastResultAt: now }, now);
      await choose('def456');
      expect((await send('POST', `${BASE}/retry`, { resumeId: 'abc123' }, FLAGGED)).statusCode).toBe(409);
    });
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
