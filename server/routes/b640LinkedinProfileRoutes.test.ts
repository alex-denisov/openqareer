import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLinkedinRewriteCache } from '../linkedinProfile/linkedinRewrite';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/linkedin/profile';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  clearLinkedinRewriteCache();
  for (const close of closers.splice(0)) await close();
});

const memory = [
  { id: 'm1', status: 'confirmed', statement: 'Вёл команду из 9 человек', domain: 'outcome', sensitive: false },
  { id: 'm2', status: 'proposed', statement: 'Увеличил выручку в 5 раз', domain: 'outcome', sensitive: false },
];
const draft = {
  targetRole: 'Инженер данных',
  candidate: { headline: 'Data engineer', about: 'Строю хранилища данных.' },
  experience: [{ id: 'e1', chronologyMemoryId: 'c1', employer: 'Лаб', title: 'Тимлид', current: true, bulletMemoryIds: ['m1', 'm2'] }],
  education: [], courses: [], languages: [], skills: [{ id: 's1', name: 'SQL' }, { id: 's2', name: 'Python' }],
};
const LINKEDIN = { platform: 'linkedin', connectedAt: '2026-11-01', lastImportedAt: '2026-11-01', factCount: 2, keptFactCount: 2 };

async function setup(experienceFactRewriter?: unknown, imported = true) {
  const h = await createB640Harness({ pool: () => [], ...(experienceFactRewriter ? { experienceFactRewriter } : {}) });
  closers.push(h.close);
  const real = h.candidates.getSnapshot.bind(h.candidates);
  vi.spyOn(h.candidates, 'getSnapshot').mockImplementation((id: string) => {
    const snapshot = real(id);
    if (id !== h.candidateIds['flagged.test']) return snapshot;
    const resume = { ...(snapshot.resume ?? {}), draft: { ...(snapshot.resume?.draft ?? {}), ...draft } };
    return { ...snapshot, memory: memory as never, resume: resume as never, importedSources: (imported ? [LINKEDIN] : []) as never };
  });
  const post = (url: string, payload: unknown, user?: HarnessUser) =>
    h.app.inject({ method: 'POST', url, payload: payload as object, headers: user ? { authorization: `Bearer ${h.tokens[user]}` } : {} });
  return { h, post };
}

const sectionOf = (body: { data: { sections: { id: string }[] } }, id: string) =>
  body.data.sections.find((section) => section.id === id) as unknown as Record<string, unknown> & { offer: unknown; places?: unknown[] };

describe('B645 a03: профиль LinkedIn из импорта', () => {
  it('без флага и без сессии — 404 на все маршруты', async () => {
    const { h, post } = await setup();
    for (const user of ['plain.test', undefined] as const) {
      expect((await h.get(BASE, user)).statusCode).toBe(404);
      expect((await post(`${BASE}/done`, { keys: ['about'] }, user)).statusCode).toBe(404);
      expect((await post(`${BASE}/offers/about/variant`, {}, user)).statusCode).toBe(404);
    }
  });

  it('без импорта LinkedIn — no_import, ручной вставки нет', async () => {
    const { h, post } = await setup(undefined, false);
    expect((await h.get(BASE, 'flagged.test')).json().data).toEqual({ kind: 'no_import' });
    expect((await h.get(BASE, 'other.test')).json().data).toEqual({ kind: 'no_import' });
    expect((await h.app.inject({ method: 'PUT', url: `${BASE}/about/current`, payload: { text: 'x' } })).statusCode).toBe(404);
    expect((await post(`${BASE}/offers/headline/variant`, {}, 'flagged.test')).statusCode).toBe(404);
  });

  it('семь разделов: «сейчас» из импорта, без фактов на выходе', async () => {
    const { h } = await setup();
    const body = (await h.get(BASE, 'flagged.test')).json();
    expect(body.data.kind).toBe('ready');
    expect(body.data.sections.map((section: { id: string }) => section.id))
      .toEqual(['headline', 'about', 'experience', 'education', 'courses', 'skills', 'languages']);
    expect(sectionOf(body, 'headline')).toEqual({
      id: 'headline', current: 'Data engineer',
      offer: { key: 'headline', text: 'Инженер данных | SQL | Python', variantsLeft: 3, doneAt: null },
    });
    expect(sectionOf(body, 'skills').current).toBe('SQL · Python');
    // B645: без переписчика факты не становятся предложением «О себе» и «Опыта» как есть.
    expect(sectionOf(body, 'about').offer).toBeNull();
    expect(sectionOf(body, 'experience').places).toEqual([{ id: 'e1', label: 'Лаб · Тимлид', current: 'Вёл команду из 9 человек', offer: null }]);
    expect(JSON.stringify(body.data)).not.toMatch(/facts|5 раз/u);
  });

  it('«О себе» — пересказ модели на подтверждённых фактах', async () => {
    const linkedinProfile = vi.fn(async () => ({
      about: { text: 'Строю и веду инженерные команды: последняя выросла до 9 человек.', factIds: ['m1'] }, places: [],
    }));
    const { h } = await setup({ rewrite: async () => null, linkedinProfile });
    const body = (await h.get(BASE, 'flagged.test')).json();
    expect(sectionOf(body, 'about').offer).toMatchObject({ text: 'Строю и веду инженерные команды: последняя выросла до 9 человек.' });
    expect(JSON.stringify(linkedinProfile.mock.calls[0])).not.toMatch(/5 раз/u);
  });

  it('«Выполнено»: по ключам, дата сохраняется, чужому кандидату не видно', async () => {
    const { h, post } = await setup();
    const done = await post(`${BASE}/done`, { keys: ['headline', 'experience:e1'] }, 'flagged.test');
    expect(done.statusCode).toBe(200);
    const at = done.json().data.done.headline;
    expect(Date.parse(at)).not.toBeNaN();
    const again = await post(`${BASE}/done`, { keys: ['headline'] }, 'flagged.test');
    expect(again.json().data.done.headline).toBe(at);
    expect((sectionOf((await h.get(BASE, 'flagged.test')).json(), 'headline').offer as { doneAt: string }).doneAt).toBe(at);
    for (const payload of [{}, { keys: [] }, { keys: ['nope'] }, { keys: ['about'], at: 'x' }]) {
      expect((await post(`${BASE}/done`, payload, 'flagged.test')).statusCode).toBe(400);
    }
  });

  it('«Предложить заново»: проверенный вариант, «Выполнено» снимается, не больше трёх', async () => {
    const texts = ['Python · SQL', 'SQL', 'Python'];
    const linkedinVariant = vi.fn(async () => ({ text: texts.shift() ?? 'SQL · Python', factIds: [] }));
    const { h, post } = await setup({ rewrite: async () => null, linkedinVariant });
    await post(`${BASE}/done`, { keys: ['skills'] }, 'flagged.test');
    const first = await post(`${BASE}/offers/skills/variant`, {}, 'flagged.test');
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({ key: 'skills', text: 'Python · SQL', variantsLeft: 2, doneAt: null });
    expect(linkedinVariant.mock.calls[0]).toMatchObject([{ target: 'skills', avoid: ['SQL · Python'] }]);
    expect(sectionOf((await h.get(BASE, 'flagged.test')).json(), 'skills').offer).toMatchObject({ text: 'Python · SQL', doneAt: null });
    expect((await post(`${BASE}/offers/skills/variant`, {}, 'flagged.test')).statusCode).toBe(200);
    expect((await post(`${BASE}/offers/skills/variant`, {}, 'flagged.test')).json().data.variantsLeft).toBe(0);
    const over = await post(`${BASE}/offers/skills/variant`, {}, 'flagged.test');
    expect([over.statusCode, over.json().error.code]).toEqual([409, 'variant_limit_reached']);
    expect(linkedinVariant).toHaveBeenCalledTimes(3);
  });

  it('ответ не прошёл проверки — 503 с повтором, вариант не сохраняется; неизвестный ключ — 400', async () => {
    const linkedinVariant = vi.fn(async () => ({ text: 'Rust · SQL', factIds: [] }));
    const { h, post } = await setup({ rewrite: async () => null, linkedinVariant });
    const failed = await post(`${BASE}/offers/skills/variant`, {}, 'flagged.test');
    expect([failed.statusCode, failed.json().error.retryable]).toEqual([503, true]);
    expect(sectionOf((await h.get(BASE, 'flagged.test')).json(), 'skills').offer).toMatchObject({ text: 'SQL · Python', variantsLeft: 3 });
    expect((await post(`${BASE}/offers/education/variant`, {}, 'flagged.test')).statusCode).toBe(400);
    expect((await post(`${BASE}/offers/experience:nope/variant`, {}, 'flagged.test')).statusCode).toBe(404);
  });

  it('данные кандидата уходят вместе с ним', async () => {
    const linkedinVariant = vi.fn(async () => ({ text: 'Python · SQL', factIds: [] }));
    const { h, post } = await setup({ rewrite: async () => null, linkedinVariant });
    await post(`${BASE}/done`, { keys: ['about'] }, 'flagged.test');
    await post(`${BASE}/offers/skills/variant`, {}, 'flagged.test');
    const db = new DatabaseSync(h.databasePath);
    try {
      db.prepare('DELETE FROM candidates WHERE id = ?').run(h.candidateIds['flagged.test']);
      const left = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE candidate_id = ?`)
        .get(h.candidateIds['flagged.test']) as { n: number }).n;
      expect(left('candidate_linkedin_section_events')).toBe(0);
      expect(left('candidate_linkedin_offer_variants')).toBe(0);
    } finally { db.close(); }
  });
});
