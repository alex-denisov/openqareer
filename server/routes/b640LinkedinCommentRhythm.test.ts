import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/linkedin';
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const POSTS = { postsPerWeek: 7, days: ALL, time: '09:00', timezone: 'UTC' };
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const call = (method: 'PUT' | 'POST', url: string, payload: unknown) =>
    h.app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${h.tokens['flagged.test']}` } });
  const draft = (id: string, kind: 'post' | 'comment' = 'comment') => {
    const db = new DatabaseSync(h.databasePath);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO candidate_drafts VALUES (?, ?, ?, 't', NULL, ?, 'draft', '2026-11-19', ?, ?)`)
      .run(id, h.candidateIds['flagged.test'], kind, 'Комментарий', now, now);
    db.prepare('INSERT INTO candidate_draft_workflow VALUES (?, ?, ?, NULL, ?)').run(id, h.candidateIds['flagged.test'], now, now);
    db.close();
  };
  const queue = async () => (await h.get(`${BASE}/queue?limit=20`, 'flagged.test')).json().data.items as Array<{ draftId: string; kind: string; scheduledAt: string }>;
  return { h, call, draft, queue };
}

const clock = (iso: string) => iso.slice(11, 16);
const day = (iso: string) => iso.slice(0, 10);

describe('B694 a05e: ритм комментариев — в день, дни, окно времени', () => {
  it('по умолчанию 2 в будни с 10:00 до 18:00; PUT сохраняет, без comments прежний ритм комментариев остаётся; плохой ввод — 400', async () => {
    const { h, call } = await setup();
    expect((await h.get(`${BASE}/rhythm`, 'flagged.test')).json().data.comments).toEqual({
      perDay: 2, days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '10:00', to: '18:00',
    });
    const comments = { perDay: 3, days: ['sat', 'mon'], from: '09:00', to: '12:00' };
    expect((await call('PUT', `${BASE}/rhythm`, { ...POSTS, comments })).statusCode).toBe(200);
    expect((await h.get(`${BASE}/rhythm`, 'flagged.test')).json().data.comments).toEqual({ ...comments, days: ['mon', 'sat'] });
    expect((await call('PUT', `${BASE}/rhythm`, { ...POSTS, postsPerWeek: 2 })).statusCode).toBe(200);
    const kept = (await h.get(`${BASE}/rhythm`, 'flagged.test')).json().data;
    expect(kept).toMatchObject({ postsPerWeek: 2, comments: { perDay: 3, from: '09:00' } });
    for (const bad of [
      { perDay: 0, days: ['mon'], from: '10:00', to: '18:00' },
      { perDay: 4, days: ['mon'], from: '10:00', to: '18:00' },
      { perDay: 2, days: [], from: '10:00', to: '18:00' },
      { perDay: 2, days: ['mon'], from: '18:00', to: '10:00' },
      { perDay: 2, days: ['mon'], from: '10:00', to: '24:00' },
    ]) expect((await call('PUT', `${BASE}/rhythm`, { ...POSTS, comments: bad })).statusCode).toBe(400);
  });

  it('одобренный комментарий встаёт в окно: слоты дня поровну, не больше «в день»', async () => {
    const { call, draft, queue } = await setup();
    await call('PUT', `${BASE}/rhythm`, { ...POSTS, comments: { perDay: 2, days: ALL, from: '10:00', to: '18:00' } });
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      draft(id);
      expect((await call('POST', `${BASE}/queue`, { draftId: id })).statusCode).toBe(200);
    }
    const items = await queue();
    expect(items.every((item) => ['10:00', '14:00'].includes(clock(item.scheduledAt)))).toBe(true);
    const perDay = new Map<string, number>();
    for (const item of items) perDay.set(day(item.scheduledAt), (perDay.get(day(item.scheduledAt)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
    expect(new Set(items.map((item) => item.scheduledAt)).size).toBe(4);
  });

  it('смена ритма переносит комментарии очереди на новые слоты; посты остаются на своём времени', async () => {
    const { call, draft, queue } = await setup();
    await call('PUT', `${BASE}/rhythm`, { ...POSTS, comments: { perDay: 3, days: ALL, from: '10:00', to: '13:00' } });
    draft('p1', 'post');
    draft('c1');
    draft('c2');
    for (const id of ['p1', 'c1', 'c2']) await call('POST', `${BASE}/queue`, { draftId: id });
    const post = (await queue()).find((item) => item.kind === 'post')!.scheduledAt;
    expect((await call('PUT', `${BASE}/rhythm`, { ...POSTS, comments: { perDay: 1, days: ALL, from: '15:30', to: '18:00' } })).statusCode).toBe(200);
    const after = await queue();
    const comments = after.filter((item) => item.kind === 'comment');
    expect(comments.map((item) => clock(item.scheduledAt))).toEqual(['15:30', '15:30']);
    expect(day(comments[0]!.scheduledAt)).not.toBe(day(comments[1]!.scheduledAt));
    expect(after.find((item) => item.kind === 'post')!.scheduledAt).toBe(post);
  });
});
