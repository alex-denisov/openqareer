import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/linkedin/feed-posts';
const URL_OK = 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup(tier: 'pro' | 'free' = 'pro', writer = vi.fn(async (_input: unknown) => ({ text: 'Согласен: у нас похожий опыт.' }))) {
  const h = await createB640Harness({ pool: () => [], linkedinDraftWriter: { writeDraft: writer } });
  closers.push(h.close);
  const sql = (query: string, ...args: string[]) => {
    const db = new DatabaseSync(h.databasePath);
    try { return db.prepare(query).all(...args); } finally { db.close(); }
  };
  sql("UPDATE users SET subscription_tier = ? WHERE username IN ('flagged.test', 'other.test', 'plain.test')", tier);
  const send = (url: string, payload: unknown, user: HarnessUser = 'flagged.test') =>
    h.app.inject({ method: 'POST', url, payload: payload as object, headers: { authorization: `Bearer ${h.tokens[user]}` } });
  return { h, send, sql, writer };
}

describe('B396: пост из ленты → черновик комментария', () => {
  it('ссылка и текст дают черновик kind=comment со ссылкой на пост; параметры ссылки отрезаются', async () => {
    const { send, sql, writer } = await setup();
    const res = await send(BASE, { url: `${URL_OK}?utm_source=share#x`, text: '  Мы сократили релиз до дня.  ' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ postUrl: URL_OK, postExcerpt: 'Мы сократили релиз до дня.', comment: 'Согласен: у нас похожий опыт.' });
    expect(sql('SELECT kind, target_post_url, status FROM candidate_drafts WHERE id = ?', data.draftId)).toEqual([
      { kind: 'comment', target_post_url: URL_OK, status: 'draft' },
    ]);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]![0]).toMatchObject({ kind: 'comment', sourceText: 'Мы сократили релиз до дня.' });
  });

  it('только текст — postUrl null; только ссылка — 400, комментарий без текста поста не пишем', async () => {
    const { send } = await setup();
    expect((await send(BASE, { text: 'Пост про тесты' })).json().data).toMatchObject({ postUrl: null, postExcerpt: 'Пост про тесты' });
    expect((await send(BASE, { url: URL_OK })).statusCode).toBe(400);
  });

  it('плохой ввод — 400 и модель не зовётся', async () => {
    const { send, writer } = await setup();
    for (const bad of [
      {}, { text: '   ' }, { url: 'http://www.linkedin.com/posts/x', text: 'x' }, { url: 'https://evil.com/linkedin.com', text: 'x' },
      { url: 'https://linkedin.com.evil.com/p', text: 'x' }, { url: 'https://u:p@www.linkedin.com/p', text: 'x' }, { text: 'я'.repeat(3001) },
      { text: 'ok', extra: 1 }, { url: 'не ссылка', text: 'x' },
    ]) expect((await send(BASE, bad)).statusCode, JSON.stringify(bad).slice(0, 40)).toBe(400);
    expect((await send(BASE, { text: 'я'.repeat(3000) })).statusCode).toBe(200);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('Free — 402 по правилам тарифа, без флага — 404, без входа — 404', async () => {
    const free = await setup('free');
    const paywall = await free.send(BASE, { text: 'Пост' });
    expect(paywall.statusCode).toBe(402);
    expect(free.writer).not.toHaveBeenCalled();
    const { send, h } = await setup();
    expect((await send(BASE, { text: 'Пост' }, 'plain.test')).statusCode).toBe(404);
    expect((await h.get(BASE, 'plain.test')).statusCode).toBe(404);
    expect((await h.post(BASE, { text: 'Пост' })).statusCode).toBe(404);
    expect((await send(`${BASE}/approve`, { draftIds: ['x'] }, 'plain.test')).statusCode).toBe(404);
  });

  it('сбой модели — 503, черновика нет', async () => {
    const { send, sql } = await setup('pro', vi.fn(async (_input: unknown): Promise<{ text: string }> => { throw new Error('down'); }));
    expect((await send(BASE, { text: 'Пост' })).statusCode).toBe(503);
    expect(sql('SELECT COUNT(*) AS n FROM candidate_feed_posts')).toEqual([{ n: 0 }]);
  });
});

describe('B396: список и пакетное одобрение', () => {
  it('список — только свои, новые сверху, с состоянием и страницами', async () => {
    const { send, h } = await setup();
    await send(BASE, { text: 'Первый' });
    await send(BASE, { text: 'Второй' });
    await send(BASE, { text: 'Чужой' }, 'other.test');
    const page = (await h.get(`${BASE}?offset=0&limit=1`, 'flagged.test')).json().data;
    expect(page).toMatchObject({ total: 2, offset: 0, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ postExcerpt: 'Второй', state: 'draft', scheduledAt: null });
    expect((await h.get(`${BASE}?limit=21`, 'flagged.test')).statusCode).toBe(400);
  });

  it('пачка: одобренные встают в очередь в разные слоты, чужой и дубль — причины, состояния меняются', async () => {
    const { send, h, sql } = await setup();
    const ids: string[] = [];
    for (const text of ['А', 'Б', 'В']) ids.push((await send(BASE, { url: URL_OK, text })).json().data.draftId);
    const alien = (await send(BASE, { text: 'Чужой' }, 'other.test')).json().data.draftId;
    const res = await send(`${BASE}/approve`, { draftIds: [ids[0], ids[1], alien, 'nope'] });
    expect(res.statusCode).toBe(200);
    const results = res.json().data.results;
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, false, false]);
    expect(results[2]).toEqual({ draftId: alien, ok: false, reason: 'not_found' });
    expect(results[0].scheduledAt).not.toBe(results[1].scheduledAt);
    const queue = sql("SELECT kind, draft_id FROM candidate_linkedin_queue WHERE candidate_id = ?", h.candidateIds['flagged.test']);
    expect(queue).toEqual(expect.arrayContaining([{ kind: 'comment', draft_id: ids[0] }]));
    expect(queue).toHaveLength(2);
    const again = (await send(`${BASE}/approve`, { draftIds: [ids[0], ids[2]] })).json().data.results;
    expect(again[0]).toEqual({ draftId: ids[0], ok: false, reason: 'already_queued' });
    expect(again[1].ok).toBe(true);
    const states = (await h.get(BASE, 'flagged.test')).json().data.items.map((i: { state: string }) => i.state);
    expect(states).toEqual(['queued', 'queued', 'queued']);
    const queued = (await h.get('/api/v1/candidate/b640/linkedin/queue', 'flagged.test')).json().data;
    expect(queued.total).toBe(3);
  });

  it('плохое тело — 400: пусто, больше 20, дубли', async () => {
    const { send } = await setup();
    for (const bad of [{ draftIds: [] }, { draftIds: Array.from({ length: 21 }, (_, i) => `d${i}`) }, { draftIds: ['a', 'a'] }, {}])
      expect((await send(`${BASE}/approve`, bad)).statusCode).toBe(400);
  });

  it('опубликованный черновик не одобряется повторно', async () => {
    const { send, sql } = await setup();
    const id = (await send(BASE, { text: 'Пост' })).json().data.draftId;
    await send(`${BASE}/approve`, { draftIds: [id] });
    const now = new Date().toISOString();
    sql("UPDATE candidate_draft_workflow SET published_at = ? WHERE draft_id = ?", now, id);
    expect((await send(`${BASE}/approve`, { draftIds: [id] })).json().data.results[0]).toEqual({ draftId: id, ok: false, reason: 'already_published' });
  });
});

describe('B396: прежние черновики не меняются', () => {
  it('POST /candidate/drafts пишет комментарий по-старому и не попадает в посты ленты', async () => {
    const { h, sql } = await setup();
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/candidate/drafts', headers: { authorization: `Bearer ${h.tokens['flagged.test']}` },
      payload: { kind: 'comment', topic: 'Тема', sourceText: URL_OK },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ kind: 'comment', targetPostUrl: URL_OK, status: 'draft' });
    expect(sql('SELECT COUNT(*) AS n FROM candidate_feed_posts')).toEqual([{ n: 0 }]);
    expect((await h.get(BASE, 'flagged.test')).json().data.total).toBe(0);
  });
});
