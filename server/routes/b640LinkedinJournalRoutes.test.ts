import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const URL = '/api/v1/candidate/b640/linkedin/journal';
const LI = '/api/v1/candidate/b640/linkedin';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const send = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, user?: HarnessUser, payload?: object) =>
    h.app.inject({
      method, url, ...(payload ? { payload } : {}),
      headers: { ...(user ? { authorization: `Bearer ${h.tokens[user]}` } : {}), origin: 'http://localhost:3000' },
    });
  const draft = (user: HarnessUser, id: string, kind: 'post' | 'comment', text: string, publishedAt: string | null = null) => {
    const db = new DatabaseSync(h.databasePath);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO candidate_drafts VALUES (?, ?, ?, 't', NULL, ?, 'draft', '2026-11-19', ?, ?)`)
      .run(id, h.candidateIds[user], kind, text, now, now);
    db.prepare('INSERT INTO candidate_draft_workflow VALUES (?, ?, ?, ?, ?)').run(id, h.candidateIds[user], now, publishedAt, now);
    db.close();
  };
  const contact = (id: string, fullName: string, user: HarnessUser = 'flagged.test') =>
    send('PUT', `/api/v1/candidate/connection-contacts/${id}`, user, { fullName, companyName: 'Гринкод', roleTitle: 'CTO', relationship: 'Коллега', strength: 'strong' });
  return { h, send, draft, contact };
}

describe('B696: GET b640/linkedin/journal', () => {
  it('без флага и без сессии — 404', async () => {
    const { send } = await setup();
    expect((await send('GET', URL)).statusCode).toBe(404);
    expect((await send('GET', URL, 'plain.test')).statusCode).toBe(404);
  });

  it('пустой журнал: ноль событий и нулевые итоги месяца', async () => {
    const { send } = await setup();
    const response = await send('GET', URL, 'flagged.test');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ events: [], total: 0, offset: 0, limit: 20, month: { posts: 0, comments: 0, replies: 0 } });
  });

  it('публикации из очереди и отметки черновика, снятие, «ответил» — только свои, без дублей', async () => {
    const { send, draft, contact } = await setup();
    draft('flagged.test', 'd-queue', 'post', 'Платёжная очередь без потерь');
    draft('flagged.test', 'd-gone', 'post', 'Старый пост');
    draft('flagged.test', 'd-direct', 'comment', 'Согласен с Ильёй', new Date().toISOString());
    draft('other.test', 'alien', 'post', 'Чужой пост', new Date().toISOString());
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const queued = (await send('POST', `${LI}/queue`, 'flagged.test', { draftId: 'd-queue', at })).json().data;
    const gone = (await send('POST', `${LI}/queue`, 'flagged.test', { draftId: 'd-gone', at: new Date(Date.now() + 2 * 86_400_000).toISOString() })).json().data;
    expect((await send('POST', `${LI}/queue/${queued.id}/published`, 'flagged.test', { url: 'https://www.linkedin.com/feed/update/urn:li:activity:1' })).statusCode).toBe(200);
    expect((await send('DELETE', `${LI}/queue/${gone.id}`, 'flagged.test')).statusCode).toBe(200);
    expect((await contact('pavel', 'Павел Ким')).statusCode).toBe(201);
    expect((await contact('anna', 'Анна Ли')).statusCode).toBe(201);
    expect((await send('PUT', '/api/v1/candidate/b640/contacts/pavel/status', 'flagged.test', { state: 'replied' })).statusCode).toBe(200);
    expect((await send('PUT', '/api/v1/candidate/b640/contacts/anna/status', 'flagged.test', { state: 'written' })).statusCode).toBe(200);

    const page = (await send('GET', URL, 'flagged.test')).json().data;
    const kinds = page.events.map((event: { kind: string }) => event.kind).sort();
    expect(kinds).toEqual(['comment_published', 'post_published', 'removed', 'replied']);
    expect(page.events.find((event: { kind: string }) => event.kind === 'post_published')).toMatchObject({
      id: `queue:${queued.id}`, text: 'Платёжная очередь без потерь', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1', contact: null,
    });
    expect(page.events.find((event: { kind: string }) => event.kind === 'replied')).toMatchObject({ contact: { id: 'pavel', name: 'Павел Ким' }, text: null });
    expect(page.month).toMatchObject({ posts: 1, comments: 1, replies: 1 });
    expect(JSON.stringify(page)).not.toContain('Чужой пост');

    const second = (await send('GET', `${URL}?offset=2&limit=2`, 'flagged.test')).json().data;
    expect(second).toMatchObject({ total: 4, offset: 2, limit: 2 });
    expect(second.events).toHaveLength(2);
    expect((await send('GET', `${URL}?limit=21`, 'flagged.test')).statusCode).toBe(400);
  });
});

