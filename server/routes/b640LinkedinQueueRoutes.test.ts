import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/linkedin';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const future = (days: number, hour = 10) => {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const call = (method: 'PUT' | 'PATCH' | 'DELETE' | 'POST', url: string, payload: unknown, user: HarnessUser = 'flagged.test') =>
    h.app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${h.tokens[user]}` } });
  const draft = (user: HarnessUser, input: { id: string; kind?: string; status?: string; approved?: boolean; published?: boolean; text?: string }) => {
    const db = new DatabaseSync(h.databasePath);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO candidate_drafts VALUES (?, ?, ?, 't', NULL, ?, ?, '2026-11-19', ?, ?)`)
      .run(input.id, h.candidateIds[user], input.kind ?? 'post', input.text ?? 'Текст '.repeat(60), input.status ?? 'draft', now, now);
    if (input.approved ?? true) {
      db.prepare('INSERT INTO candidate_draft_workflow VALUES (?, ?, ?, ?, ?)')
        .run(input.id, h.candidateIds[user], now, input.published ? now : null, now);
    }
    db.close();
  };
  const sql = (query: string, ...args: string[]) => {
    const db = new DatabaseSync(h.databasePath);
    try { return db.prepare(query).run(...args); } finally { db.close(); }
  };
  return { h, call, draft, sql };
}

describe('B694: ритм', () => {
  it('без настройки — значение из макета, PUT сохраняет, плохой ввод — 400', async () => {
    const { h, call } = await setup();
    const first = await h.get(`${BASE}/rhythm`, 'flagged.test');
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ postsPerWeek: 1, days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '10:00' });
    const saved = await call('PUT', `${BASE}/rhythm`, { postsPerWeek: 3, days: ['tue', 'thu'], time: '09:30', timezone: 'Europe/Berlin' });
    expect(saved.statusCode).toBe(200);
    expect((await h.get(`${BASE}/rhythm`, 'flagged.test')).json().data).toEqual({ postsPerWeek: 3, days: ['tue', 'thu'], time: '09:30', timezone: 'Europe/Berlin' });
    expect((await h.get(`${BASE}/rhythm`, 'other.test')).json().data.postsPerWeek).toBe(1);
    for (const bad of [
      { postsPerWeek: 0, days: ['mon'], time: '10:00', timezone: 'UTC' },
      { postsPerWeek: 8, days: ['mon'], time: '10:00', timezone: 'UTC' },
      { postsPerWeek: 2, days: [], time: '10:00', timezone: 'UTC' },
      { postsPerWeek: 2, days: ['mon'], time: '25:00', timezone: 'UTC' },
      { postsPerWeek: 2, days: ['mon'], time: '10:00', timezone: 'Mars/Base' },
    ]) expect((await call('PUT', `${BASE}/rhythm`, bad)).statusCode).toBe(400);
  });
});

describe('B694: очередь', () => {
  it('одобренный черновик встаёт в слот ритма, чужой и неодобренный — нет', async () => {
    const { call, draft } = await setup();
    await call('PUT', `${BASE}/rhythm`, { postsPerWeek: 7, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], time: '10:00', timezone: 'UTC' });
    draft('flagged.test', { id: 'd1' });
    draft('flagged.test', { id: 'd2' });
    draft('flagged.test', { id: 'raw', approved: false });
    draft('other.test', { id: 'alien' });
    const one = await call('POST', `${BASE}/queue`, { draftId: 'd1' });
    expect(one.statusCode).toBe(200);
    const a = one.json().data;
    expect(a).toMatchObject({ draftId: 'd1', kind: 'post', state: 'queued' });
    expect(a.text.length).toBeLessThanOrEqual(140);
    expect(a.scheduledAt.endsWith('T10:00:00.000Z')).toBe(true);
    expect(new Date(a.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    const b = (await call('POST', `${BASE}/queue`, { draftId: 'd2' })).json().data;
    expect(new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()).toBe(86_400_000);
    expect((await call('POST', `${BASE}/queue`, { draftId: 'd1' })).statusCode).toBe(409);
    expect((await call('POST', `${BASE}/queue`, { draftId: 'raw' })).statusCode).toBe(409);
    expect((await call('POST', `${BASE}/queue`, { draftId: 'alien' })).statusCode).toBe(404);
    expect((await call('POST', `${BASE}/queue`, { draftId: 'none' })).statusCode).toBe(404);
    expect((await call('POST', `${BASE}/queue`, { draftId: 'd2', at: 'вчера' })).statusCode).toBe(400);
  });

  it('postsPerWeek ограничивает слоты недели: второй пост уходит на следующую неделю', async () => {
    const { call, draft } = await setup();
    await call('PUT', `${BASE}/rhythm`, { postsPerWeek: 1, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], time: '10:00', timezone: 'UTC' });
    draft('flagged.test', { id: 'd1' });
    draft('flagged.test', { id: 'd2' });
    const a = (await call('POST', `${BASE}/queue`, { draftId: 'd1' })).json().data.scheduledAt;
    const b = (await call('POST', `${BASE}/queue`, { draftId: 'd2' })).json().data.scheduledAt;
    expect(new Date(b).getTime() - new Date(a).getTime()).toBeGreaterThanOrEqual(86_400_000);
    expect(new Date(b).getUTCDay()).toBe(1);
  });

  it('явное время, перенос, due, снятие и повторная постановка', async () => {
    const { h, call, draft, sql } = await setup();
    draft('flagged.test', { id: 'd1', kind: 'comment' });
    const at = future(3);
    const queued = (await call('POST', `${BASE}/queue`, { draftId: 'd1', at })).json().data;
    expect(queued).toMatchObject({ scheduledAt: at, kind: 'comment', state: 'queued' });
    expect((await call('PATCH', `${BASE}/queue/${queued.id}`, { at: '2020-01-01T10:00:00Z' })).statusCode).toBe(400);
    const moved = await call('PATCH', `${BASE}/queue/${queued.id}`, { at: future(5) });
    expect(moved.json().data.scheduledAt).toBe(future(5));
    expect((await h.get(`${BASE}/queue?state=queued`, 'flagged.test')).json().data.items).toHaveLength(1);
    sql('UPDATE candidate_linkedin_queue SET scheduled_at = ? WHERE id = ?', '2020-01-01T10:00:00.000Z', queued.id);
    const due = (await h.get(`${BASE}/queue?state=due`, 'flagged.test')).json().data;
    expect(due.items.map((i: { state: string }) => i.state)).toEqual(['due']);
    expect((await h.get(`${BASE}/queue?state=queued`, 'flagged.test')).json().data.items).toHaveLength(0);
    expect(due.items[0]).toMatchObject({ openUrl: null, remindedAt: null });
    const reminded = await call('POST', `${BASE}/queue/${queued.id}/reminded`, {});
    expect(reminded.json().data.remindedAt).toEqual(expect.any(String));
    expect((await call('POST', `${BASE}/queue/${queued.id}/reminded`, {}, 'other.test')).statusCode).toBe(404);
    const removed = await call('DELETE', `${BASE}/queue/${queued.id}`, undefined);
    expect(removed.json().data.state).toBe('removed');
    expect((await call('PATCH', `${BASE}/queue/${queued.id}`, { at: future(6) })).statusCode).toBe(409);
    const again = await call('POST', `${BASE}/queue`, { draftId: 'd1', at: future(4) });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.id).not.toBe(queued.id);
    expect((await h.get(`${BASE}/queue?state=removed`, 'flagged.test')).json().data.total).toBe(1);
  });

  it('due: у поста openUrl окна создания, у комментария — ссылка поста; reminded не двигает время', async () => {
    const { h, call, draft, sql } = await setup();
    draft('flagged.test', { id: 'p1' });
    const post = (await call('POST', `${BASE}/queue`, { draftId: 'p1', at: future(2) })).json().data;
    expect(post.openUrl).toBeNull();
    sql('UPDATE candidate_linkedin_queue SET scheduled_at = ? WHERE id = ?', '2020-01-01T10:00:00.000Z', post.id);
    const first = (await call('POST', `${BASE}/queue/${post.id}/reminded`, {})).json().data;
    const second = (await call('POST', `${BASE}/queue/${post.id}/reminded`, {})).json().data;
    expect(second.remindedAt).toBe(first.remindedAt);
    expect(first).toMatchObject({ state: 'due', openUrl: 'https://www.linkedin.com/feed/?shareActive=true', scheduledAt: '2020-01-01T10:00:00.000Z' });
    const listed = (await h.get(`${BASE}/queue?state=due`, 'flagged.test')).json().data.items[0];
    expect(listed.remindedAt).toBe(first.remindedAt);
    draft('flagged.test', { id: 'c1', kind: 'comment' });
    sql("UPDATE candidate_drafts SET target_post_url = 'https://www.linkedin.com/posts/x' WHERE id = 'c1'");
    const comment = (await call('POST', `${BASE}/queue`, { draftId: 'c1', at: future(3) })).json().data;
    sql('UPDATE candidate_linkedin_queue SET scheduled_at = ? WHERE id = ?', '2020-01-02T10:00:00.000Z', comment.id);
    const due = (await h.get(`${BASE}/queue?state=due`, 'flagged.test')).json().data.items;
    expect(due.find((i: { kind: string }) => i.kind === 'comment').openUrl).toBe('https://www.linkedin.com/posts/x');
    expect((await call('POST', `${BASE}/queue/${post.id}/published`, {})).json().data.state).toBe('done');
    expect((await call('POST', `${BASE}/queue/${post.id}/reminded`, {})).statusCode).toBe(409);
  });

  it('опубликован: только https linkedin.com, потом done; чужую строку не тронуть', async () => {
    const { h, call, draft } = await setup();
    draft('flagged.test', { id: 'd1' });
    const item = (await call('POST', `${BASE}/queue`, { draftId: 'd1', at: future(2) })).json().data;
    for (const url of ['http://www.linkedin.com/posts/x', 'https://evil.example/linkedin.com', 'https://linkedin.com.evil.test/x', 'javascript:alert(1)'])
      expect((await call('POST', `${BASE}/queue/${item.id}/published`, { url })).statusCode).toBe(400);
    expect((await call('POST', `${BASE}/queue/${item.id}/published`, {}, 'other.test')).statusCode).toBe(404);
    expect((await call('PATCH', `${BASE}/queue/${item.id}`, { at: future(9) }, 'other.test')).statusCode).toBe(404);
    expect((await call('DELETE', `${BASE}/queue/${item.id}`, undefined, 'other.test')).statusCode).toBe(404);
    const done = await call('POST', `${BASE}/queue/${item.id}/published`, { url: 'https://www.linkedin.com/posts/abc' });
    expect(done.json().data.state).toBe('done');
    expect((await call('DELETE', `${BASE}/queue/${item.id}`, undefined)).statusCode).toBe(409);
    expect((await h.get(`${BASE}/queue?state=done`, 'flagged.test')).json().data.total).toBe(1);
    expect((await h.get(`${BASE}/queue`, 'other.test')).json().data.total).toBe(0);
  });

  it('B695: «Остановить всё» ставит очередь на паузу — ничего не наступает, напоминание не ставится; снятие паузы возвращает', async () => {
    const { h, call, draft, sql } = await setup();
    draft('flagged.test', { id: 'd1' });
    const queued = (await call('POST', `${BASE}/queue`, { draftId: 'd1', at: future(2) })).json().data;
    sql('UPDATE candidate_linkedin_queue SET scheduled_at = ? WHERE id = ?', '2020-01-01T10:00:00.000Z', queued.id);
    expect((await h.get(`${BASE}/queue?state=due`, 'flagged.test')).json().data).toMatchObject({ total: 1, paused: false });

    expect((await call('POST', '/api/v1/candidate/automation/pause', { days: 365 })).statusCode).toBe(200);
    const paused = (await h.get(`${BASE}/queue`, 'flagged.test')).json().data;
    expect(paused).toMatchObject({ total: 1, paused: true });
    expect(paused.items[0]).toMatchObject({ state: 'queued', openUrl: null });
    expect((await h.get(`${BASE}/queue?state=due`, 'flagged.test')).json().data.total).toBe(0);
    expect((await call('POST', `${BASE}/queue/${queued.id}/reminded`, {})).statusCode).toBe(409);
    // Пауза одного кандидата не трогает другого.
    expect((await h.get(`${BASE}/queue`, 'other.test')).json().data.paused).toBe(false);

    expect((await call('DELETE', '/api/v1/candidate/automation/pause', undefined)).statusCode).toBe(200);
    const resumed = (await h.get(`${BASE}/queue?state=due`, 'flagged.test')).json().data;
    expect(resumed).toMatchObject({ total: 1, paused: false });
  });

  it('B695: напоминание «Пора опубликовать пост» — на время строки, переносится, снимается при удалении, публикации и «Остановить всё»', async () => {
    const { h, call, draft } = await setup();
    const reminders = (user: HarnessUser = 'flagged.test') => {
      const db = new DatabaseSync(h.databasePath);
      try {
        return db.prepare(`SELECT source_type, source_id, created_at FROM candidate_notifications
          WHERE candidate_id = ? AND event_kind = 'post_reminder' ORDER BY created_at`).all(h.candidateIds[user]);
      } finally { db.close(); }
    };
    draft('flagged.test', { id: 'd1' });
    draft('flagged.test', { id: 'd2' });
    draft('flagged.test', { id: 'c1', kind: 'comment' });
    const first = (await call('POST', `${BASE}/queue`, { draftId: 'd1', at: future(2) })).json().data;
    expect(reminders()).toEqual([{ source_type: 'linkedin_queue', source_id: first.id, created_at: first.scheduledAt }]);
    await call('POST', `${BASE}/queue`, { draftId: 'c1', at: future(4) });
    expect(reminders()).toHaveLength(1);

    const moved = (await call('PATCH', `${BASE}/queue/${first.id}`, { at: future(3) })).json().data;
    expect(reminders()).toEqual([{ source_type: 'linkedin_queue', source_id: first.id, created_at: moved.scheduledAt }]);

    const second = (await call('POST', `${BASE}/queue`, { draftId: 'd2', at: future(5) })).json().data;
    expect(reminders()).toHaveLength(2);
    expect((await call('POST', '/api/v1/candidate/automation/pause', { days: 365 })).statusCode).toBe(200);
    expect(reminders()).toEqual([]);
    // На паузе перенос не ставит напоминание заново.
    await call('PATCH', `${BASE}/queue/${second.id}`, { at: future(6) });
    expect(reminders()).toEqual([]);
    expect((await call('DELETE', '/api/v1/candidate/automation/pause', undefined)).statusCode).toBe(200);
    expect(reminders().map((row) => (row as { source_id: string }).source_id).sort()).toEqual([first.id, second.id].sort());

    await call('POST', `${BASE}/queue/${first.id}/published`, {});
    await call('DELETE', `${BASE}/queue/${second.id}`, undefined);
    expect(reminders()).toEqual([]);
    expect(reminders('other.test')).toEqual([]);
  });

  it('страницы: limit не больше 20, сортировка по времени', async () => {
    const { h, call, draft } = await setup();
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      draft('flagged.test', { id });
      await call('POST', `${BASE}/queue`, { draftId: id, at: future(10 - i) });
    }
    const page = (await h.get(`${BASE}/queue?limit=2&offset=0`, 'flagged.test')).json().data;
    expect(page.items.map((i: { draftId: string }) => i.draftId)).toEqual(['c', 'b']);
    expect(page.total).toBe(3);
    expect((await h.get(`${BASE}/queue?limit=21`, 'flagged.test')).statusCode).toBe(400);
    expect((await h.get(`${BASE}/queue?state=weird`, 'flagged.test')).statusCode).toBe(400);
  });

  it('без флага и без сессии — 404, прежние маршруты черновиков работают как раньше', async () => {
    const { h, call, draft } = await setup();
    expect((await h.get(`${BASE}/queue`, 'plain.test')).statusCode).toBe(404);
    expect((await h.get(`${BASE}/queue`)).statusCode).toBe(404);
    expect((await h.get(`${BASE}/rhythm`, 'plain.test')).statusCode).toBe(404);
    expect((await call('PUT', `${BASE}/rhythm`, { postsPerWeek: 1, days: ['mon'], time: '10:00', timezone: 'UTC' }, 'plain.test')).statusCode).toBe(404);
    draft('flagged.test', { id: 'd1' });
    const before = (await h.get('/api/v1/candidate/drafts', 'flagged.test')).json();
    await call('POST', `${BASE}/queue`, { draftId: 'd1', at: future(2) });
    expect((await h.get('/api/v1/candidate/drafts', 'flagged.test')).json()).toEqual(before);
    expect(before.data[0]).toMatchObject({ id: 'd1', status: 'approved' });
  });
});
