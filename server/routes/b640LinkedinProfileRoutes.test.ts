import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLinkedinRewriteCache } from '../linkedinProfile/linkedinRewrite';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/linkedin/profile';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) await close();
});

const memory = [
  { id: 'm1', status: 'confirmed', statement: 'Вёл команду из 9 человек', domain: 'outcome', sensitive: false },
  { id: 'm2', status: 'proposed', statement: 'Увеличил выручку в 5 раз', domain: 'outcome', sensitive: false },
];

async function setup(experienceFactRewriter?: unknown) {
  const h = await createB640Harness({ pool: () => [], ...(experienceFactRewriter ? { experienceFactRewriter } : {}) });
  closers.push(h.close);
  const real = h.candidates.getSnapshot.bind(h.candidates);
  vi.spyOn(h.candidates, 'getSnapshot').mockImplementation((id: string) => {
    const snapshot = real(id);
    return id === h.candidateIds['flagged.test'] ? { ...snapshot, memory: memory as never } : snapshot;
  });
  const send = (method: 'PUT' | 'POST', url: string, payload: unknown, user?: HarnessUser) =>
    h.app.inject({ method, url, payload: payload as object, headers: user ? { authorization: `Bearer ${h.tokens[user]}` } : {} });
  return { h, send };
}

describe('B692: профиль LinkedIn по разделам', () => {
  it('без флага и без сессии — 404 на все маршруты', async () => {
    const { h, send } = await setup();
    for (const user of ['plain.test', undefined] as const) {
      expect((await h.get(BASE, user)).statusCode).toBe(404);
      expect((await send('PUT', `${BASE}/about/current`, { text: 'x' }, user)).statusCode).toBe(404);
      expect((await send('POST', `${BASE}/about/copied`, {}, user)).statusCode).toBe(404);
      expect((await send('POST', `${BASE}/about/pasted`, {}, user)).statusCode).toBe(404);
    }
  });

  it('GET: четыре раздела, предложение только на подтверждённых фактах', async () => {
    const { h } = await setup();
    const response = await h.get(BASE, 'flagged.test');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.requestId).toBeTruthy();
    expect(Object.keys(body.data)).toEqual(['headline', 'about', 'experience', 'skills']);
    expect(body.data.headline).toEqual({
      current: null, copiedAt: null, pastedAt: null,
      suggestion: { text: 'Инженер данных', facts: [{ id: 'resume:targetRole', text: 'Целевая роль: Инженер данных' }] },
    });
    // B645: без переписчика факты не становятся предложением «О себе» как есть.
    expect(body.data.about.suggestion).toBeNull();
    expect(JSON.stringify(body.data)).not.toMatch(/5 раз/u);
    expect(body.data.skills.suggestion).toBeNull();
  });

  it('B645: «О себе» — пересказ модели на подтверждённых фактах, неподтверждённые ей не уходят', async () => {
    clearLinkedinRewriteCache();
    const linkedinProfile = vi.fn(async () => ({
      about: { text: 'Строю и веду инженерные команды: последняя выросла до 9 человек.', factIds: ['m1'] },
      places: [],
    }));
    const { h } = await setup({ rewrite: async () => null, linkedinProfile });
    const body = (await h.get(BASE, 'flagged.test')).json();
    expect(body.data.about.suggestion).toEqual({
      text: 'Строю и веду инженерные команды: последняя выросла до 9 человек.',
      facts: [{ id: 'm1', text: 'Вёл команду из 9 человек' }],
    });
    const request = JSON.stringify(linkedinProfile.mock.calls[0]);
    expect(request).toContain('Вёл команду из 9 человек');
    expect(request).not.toMatch(/5 раз/u);
  });

  it('PUT current сохраняет вставленный текст, виден только своему кандидату', async () => {
    const { h, send } = await setup();
    const saved = await send('PUT', `${BASE}/headline/current`, { text: '  Старый заголовок  ' }, 'flagged.test');
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ text: 'Старый заголовок', source: 'paste' });
    const mine = (await h.get(BASE, 'flagged.test')).json().data.headline.current;
    expect(mine).toMatchObject({ text: 'Старый заголовок', source: 'paste' });
    expect(Date.parse(mine.capturedAt)).not.toBeNaN();
    const other = (await h.get(BASE, 'other.test')).json().data;
    expect(other.headline.current).toBeNull();
    expect(other.about.suggestion).toBeNull();
    await send('PUT', `${BASE}/headline/current`, { text: 'Новый' }, 'flagged.test');
    expect((await h.get(BASE, 'flagged.test')).json().data.headline.current.text).toBe('Новый');
  });

  it('copied и pasted сохраняются по разделу', async () => {
    const { h, send } = await setup();
    const copied = await send('POST', `${BASE}/about/copied`, {}, 'flagged.test');
    expect(copied.json().data).toMatchObject({ pastedAt: null });
    expect(copied.json().data.copiedAt).toBeTruthy();
    expect((await send('POST', `${BASE}/about/pasted`, undefined, 'flagged.test')).statusCode).toBe(200);
    const view = (await h.get(BASE, 'flagged.test')).json().data;
    expect(view.about.copiedAt).toBeTruthy();
    expect(view.about.pastedAt).toBeTruthy();
    expect(view.headline.copiedAt).toBeNull();
    expect((await h.get(BASE, 'other.test')).json().data.about.pastedAt).toBeNull();
  });

  it('плохой ввод — 400, ничего не сохраняется', async () => {
    const { h, send } = await setup();
    const put = (section: string, payload: unknown) => send('PUT', `${BASE}/${section}/current`, payload, 'flagged.test');
    expect((await put('headline', { text: 'x'.repeat(221) })).statusCode).toBe(400);
    expect((await put('about', { text: 'x'.repeat(2601) })).statusCode).toBe(400);
    expect((await put('about', { text: 'x'.repeat(2600) })).statusCode).toBe(200);
    expect((await put('about', { text: '   ' })).statusCode).toBe(400);
    expect((await put('about', { text: 'ok', source: 'archive' })).statusCode).toBe(400);
    expect((await put('about', {})).statusCode).toBe(400);
    expect((await put('education', { text: 'ok' })).statusCode).toBe(400);
    expect((await send('POST', `${BASE}/nope/copied`, {}, 'flagged.test')).statusCode).toBe(400);
    expect((await send('POST', `${BASE}/about/pasted`, { at: 'вчера' }, 'flagged.test')).statusCode).toBe(400);
    const view = (await h.get(BASE, 'flagged.test')).json().data;
    expect(view.headline.current).toBeNull();
    expect(view.about.pastedAt).toBeNull();
  });

  it('данные кандидата уходят вместе с ним', async () => {
    const { h, send } = await setup();
    await send('PUT', `${BASE}/about/current`, { text: 'Текст' }, 'other.test');
    await send('POST', `${BASE}/about/copied`, {}, 'other.test');
    const db = new DatabaseSync(h.databasePath);
    try {
      db.prepare('DELETE FROM candidates WHERE id = ?').run(h.candidateIds['other.test']);
      const left = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE candidate_id = ?`)
        .get(h.candidateIds['other.test']) as { n: number }).n;
      expect(left('candidate_linkedin_sections')).toBe(0);
      expect(left('candidate_linkedin_section_events')).toBe(0);
    } finally { db.close(); }
  });
});
