import { readFileSync, existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OWN_VACANCY_MAX } from '../../shared/b640OwnVacancy';
import { createB640Harness, poolItem, type HarnessUser } from '../testHelpers/b640VacancyHarness';
import { forgetMatchedListsForTests } from './matchedVacancyList';
import { forgetLinkReadSlotsForTests } from '../vacancies/ownVacancy/linkReadLimit';

const reader = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../vacancies/ownVacancy/pageReader', () => ({ readVacancyPage: reader.read }));

const BASE = '/api/v1/candidate/b640/own-vacancies';
const SECRET = 'УНИКАЛЬНАЯ-ФРАЗА-ДЛЯ-ПРОВЕРКИ-ХРАНЕНИЯ-7731';
const REQ_LINE = 'Опыт работы с Python от пяти лет';
const TEXT = `Инженер данных\n\n${SECRET} — это строка описания без требований.\n\nТребования\n- ${REQ_LINE}\n- SQL\n`;
const PAGE_HTML = (title: string) => `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'JobPosting', title, hiringOrganization: { name: 'Ромашка' },
  description: `<p>${'Платформа данных и аналитика для крупного бизнеса. '.repeat(12)}</p><ul><li>Python</li><li>SQL</li></ul>`,
})}</script></head><body></body></html>`;
const closers: Array<() => Promise<void>> = [];
beforeEach(() => reader.read.mockReset());
afterEach(async () => {
  forgetMatchedListsForTests();
  forgetLinkReadSlotsForTests();
  for (const close of closers.splice(0)) await close();
});

async function setup(engine?: Record<string, unknown>) {
  const harness = await createB640Harness({ pool: () => [poolItem({ id: 'cluster-a', title: 'Роль a', company: 'К' })], ...(engine ? { engine } : {}) });
  closers.push(harness.close);
  const send = (method: 'GET' | 'POST' | 'DELETE', url: string, user?: HarnessUser, payload?: unknown) =>
    harness.app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }),
      headers: user ? { authorization: `Bearer ${harness.tokens[user]}` } : {} });
  return { ...harness, send };
}
type Harness = Awaited<ReturnType<typeof setup>>;
const createText = (h: Harness, text = TEXT, user: HarnessUser = 'flagged.test') => h.send('POST', BASE, user, { text });

describe('b640/own-vacancies: ворота', () => {
  it('без сессии и без флага — 404 на все четыре маршрута', async () => {
    const h = await setup();
    const requests: Array<['GET' | 'POST' | 'DELETE', string, unknown?]> = [
      ['POST', BASE, { text: TEXT }], ['GET', BASE], ['GET', `${BASE}/own-${crypto.randomUUID()}`], ['DELETE', `${BASE}/own-${crypto.randomUUID()}`],
    ];
    for (const user of [undefined, 'plain.test'] as const) {
      for (const [method, url, payload] of requests) {
        expect((await h.send(method, url, user, payload)).statusCode, `${method} ${user}`).toBe(404);
      }
    }
  });
});

describe('POST own-vacancies', () => {
  it('создаёт по тексту: название — первая строка, компании нет, ссылки нет', async () => {
    const h = await setup();
    const response = await createText(h);
    expect(response.statusCode).toBe(200);
    const { data, meta } = response.json();
    expect(typeof meta.requestId).toBe('string');
    expect(data.outcome).toBe('created');
    expect(data.vacancy).toMatchObject({ title: 'Инженер данных', company: null, url: null, coverage: null });
    expect(data.vacancy.id).toMatch(/^own-[0-9a-f-]{36}$/u);
    expect(reader.read).not.toHaveBeenCalled();
  });
  it('создаёт по ссылке: читает страницу один раз', async () => {
    const h = await setup();
    reader.read.mockResolvedValue({ ok: true, html: PAGE_HTML('Аналитик') });
    const response = await h.send('POST', BASE, 'flagged.test', { link: 'https://jobs.example.com/a/1' });
    expect(response.json().data).toMatchObject({ outcome: 'created', vacancy: { title: 'Аналитик', company: 'Ромашка', url: 'https://jobs.example.com/a/1' } });
    expect(reader.read).toHaveBeenCalledTimes(1);
  });
  it.each([['site_closed', 'site_closed'], ['failed', 'failed']])('нечитаемая страница: %s', async (reason) => {
    const h = await setup();
    reader.read.mockResolvedValue({ ok: false, reason });
    const data = (await h.send('POST', BASE, 'flagged.test', { link: 'https://jobs.example.com/a/1' })).json().data;
    expect(data).toEqual({ outcome: 'unreadable', reason });
  });
  it('короткая страница — thin; страница с проверкой «не робот» — failed', async () => {
    const h = await setup();
    reader.read.mockResolvedValueOnce({ ok: true, html: '<html><body><p>Коротко</p></body></html>' });
    expect((await h.send('POST', BASE, 'flagged.test', { link: 'https://jobs.example.com/1' })).json().data).toEqual({ outcome: 'unreadable', reason: 'thin' });
    reader.read.mockResolvedValueOnce({ ok: true, html: '<html><body><p>Подтвердите, что вы не робот. Captcha</p></body></html>' });
    expect((await h.send('POST', BASE, 'flagged.test', { link: 'https://jobs.example.com/2' })).json().data).toEqual({ outcome: 'unreadable', reason: 'failed' });
    expect((await h.send('GET', BASE, 'flagged.test')).json().data).toEqual([]);
  });
  it('ссылка hh.ru на вакансию из пула — in_pool; вне пула — site_closed без запроса', async () => {
    const h = await setup({
      getVacancy: (id: string) => (id === 'src-hh-search:12345678' ? { id } : undefined),
      getActiveCluster: (id: string) => (id === 'src-hh-search:12345678' ? { id: 'cluster-hh-1', status: 'active' } : undefined),
    });
    const inPool = await h.send('POST', BASE, 'flagged.test', { link: 'https://hh.ru/vacancy/12345678' });
    expect(inPool.json().data).toEqual({ outcome: 'in_pool', clusterId: 'cluster-hh-1' });
    const outside = await h.send('POST', BASE, 'flagged.test', { link: 'https://hh.ru/vacancy/99999999' });
    expect(outside.json().data).toEqual({ outcome: 'unreadable', reason: 'site_closed' });
    expect(reader.read).not.toHaveBeenCalled();
  });
  it('B707: ссылка hh.ru на вакансию из подборки — in_pool, как ищет прод', async () => {
    const live = {
      id: 'src-hh-search:139180469', fingerprint: 'f', title: 'Директор по данным', company: 'Ромашка',
      description: 'Платформа данных', requiredSkills: [], isRemote: true, url: 'https://hh.ru/vacancy/139180469',
      publishedAt: '2026-11-17T00:00:00.000Z', status: 'active',
      provenance: { sourceType: 'json_api', sourceId: 'src-hh-search', sourceUrl: 'https://hh.ru/vacancy/139180469', observedAt: '2026-11-18T00:00:00.000Z' },
    };
    const saved = { id: 'cluster-founder', status: 'active' };
    // Движок прода: кластер ищется только по id строки `cluster-…` (и ключу `member` за ним).
    const h = await setup({
      getVacancy: (id: string) => (id === live.id || id === 'src-hh-search:22222222' ? { ...live, id } : undefined),
      getActiveCluster: (id: string) => (id === 'cluster-src-hh-search:22222222' ? saved : undefined),
    });
    const fromPool = await h.send('POST', BASE, 'flagged.test', { link: 'https://hh.ru/vacancy/139180469' });
    expect(fromPool.json().data).toEqual({ outcome: 'in_pool', clusterId: 'cluster-src-hh-search:139180469' });
    const glued = await h.send('POST', BASE, 'flagged.test', { link: 'https://hh.ru/vacancy/22222222/' });
    expect(glued.json().data).toEqual({ outcome: 'in_pool', clusterId: 'cluster-founder' });
    const gone = await h.send('POST', BASE, 'flagged.test', { link: 'https://hh.ru/vacancy/33333333' });
    expect(gone.json().data).toEqual({ outcome: 'unreadable', reason: 'site_closed' });
    expect(reader.read).not.toHaveBeenCalled();
  });
  it('предел — limit', async () => {
    const h = await setup();
    for (let index = 0; index < OWN_VACANCY_MAX; index += 1) {
      expect((await createText(h, `Роль ${index}\n\n${'описание вакансии '.repeat(5)}`)).json().data.outcome).toBe('created');
    }
    expect((await createText(h)).json().data).toEqual({ outcome: 'limit' });
    expect((await createText(h, TEXT, 'other.test')).json().data.outcome).toBe('created');
  });
  it.each([
    [{}], [{ link: 'https://a.example/x', text: TEXT }], [{ text: 'коротко' }], [{ text: 'я'.repeat(30_001) }],
    [{ link: 'ftp://a.example/x' }], [{ link: `https://a.example/${'x'.repeat(2048)}` }], [{ text: TEXT, extra: 1 }],
  ])('неверное тело %j — 400', async (body) => {
    const h = await setup();
    expect((await h.send('POST', BASE, 'flagged.test', body)).statusCode).toBe(400);
  });
  it('чтение чужих страниц: одно за раз и не больше 10 за 10 минут — дальше 429', async () => {
    const h = await setup();
    let finish: (value: unknown) => void = () => undefined;
    reader.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const slow = h.send('POST', BASE, 'flagged.test', { link: 'https://jobs.example.com/slow' });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1));
    expect((await h.send('POST', BASE, 'flagged.test', { link: 'https://jobs.example.com/b' })).statusCode).toBe(429);
    finish({ ok: false, reason: 'failed' });
    expect((await slow).statusCode).toBe(200);
    reader.read.mockResolvedValue({ ok: false, reason: 'failed' });
    for (let index = 0; index < 9; index += 1) {
      expect((await h.send('POST', BASE, 'flagged.test', { link: `https://jobs.example.com/${index}` })).statusCode).toBe(200);
    }
    expect((await h.send('POST', BASE, 'flagged.test', { link: 'https://jobs.example.com/x' })).statusCode).toBe(429);
    expect((await createText(h)).json().data.outcome).toBe('created');
    expect((await h.send('POST', BASE, 'other.test', { link: 'https://jobs.example.com/x' })).statusCode).toBe(200);
  });
  it('тело больше 64 КБ — 413', async () => {
    const h = await setup();
    expect((await h.send('POST', BASE, 'flagged.test', { text: 'я'.repeat(40_000) })).statusCode).toBe(413);
  });
});

describe('GET и DELETE own-vacancies', () => {
  it('список только свой, новые первыми; чтение и удаление чужой — 404', async () => {
    const h = await setup();
    const first = (await createText(h, `Первая\n\n${'описание вакансии '.repeat(5)}`)).json().data.vacancy;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = (await createText(h, `Вторая\n\n${'описание вакансии '.repeat(5)}`)).json().data.vacancy;
    const foreign = (await createText(h, TEXT, 'other.test')).json().data.vacancy;
    const list = (await h.send('GET', BASE, 'flagged.test')).json().data;
    expect(list.map((item: { id: string }) => item.id)).toEqual([second.id, first.id]);
    expect(list[0]).not.toHaveProperty('text');
    expect((await h.send('GET', `${BASE}/${foreign.id}`, 'flagged.test')).statusCode).toBe(404);
    expect((await h.send('DELETE', `${BASE}/${foreign.id}`, 'flagged.test')).statusCode).toBe(404);
    expect((await h.send('GET', `${BASE}/${foreign.id}`, 'other.test')).statusCode).toBe(200);
    expect((await h.send('GET', `${BASE}/own-${crypto.randomUUID()}`, 'flagged.test')).statusCode).toBe(404);
    expect((await h.send('GET', `${BASE}/not-an-id`, 'flagged.test')).statusCode).toBe(404);
  });
  it('деталь: текст с абзацами и вид сравнения с профилем без процента', async () => {
    const h = await setup();
    const { id } = (await createText(h)).json().data.vacancy;
    const detail = (await h.send('GET', `${BASE}/${id}`, 'flagged.test')).json().data;
    expect(detail.text).toContain(SECRET);
    expect(detail.text).toContain('\n\n');
    expect(detail.fit.requirements.length).toBeGreaterThan(0);
    expect(detail.comparing).toBe(true);
    expect(detail.fit.result?.coveragePercent ?? null).toBeNull();
  });
  it('текст лежит запечатанным; удаление убирает строку и требования', async () => {
    const h = await setup();
    const { id } = (await createText(h)).json().data.vacancy;
    await h.send('GET', `${BASE}/${id}`, 'flagged.test');
    const raw = () => ['', '-wal'].map((suffix) => (existsSync(h.databasePath + suffix) ? readFileSync(h.databasePath + suffix).toString('latin1') : '')).join('');
    const bytes = (value: string) => Buffer.from(value, 'utf8').toString('latin1');
    expect(raw()).not.toContain(bytes(SECRET));
    expect(raw()).not.toContain(bytes('Инженер данных'));
    expect((await h.send('DELETE', `${BASE}/${id}`, 'flagged.test')).statusCode).toBe(204);
    expect((await h.send('GET', `${BASE}/${id}`, 'flagged.test')).statusCode).toBe(404);
    expect((await h.send('GET', BASE, 'flagged.test')).json().data).toEqual([]);
    expect((await h.send('DELETE', `${BASE}/${id}`, 'flagged.test')).statusCode).toBe(404);
    expect(raw()).not.toContain(bytes(REQ_LINE));
  });
  it('в журнал не попадают текст и адрес с параметрами', async () => {
    const lines: string[] = [];
    const harness = await createB640Harness({ pool: () => [], logLines: lines });
    closers.push(harness.close);
    reader.read.mockResolvedValue({ ok: true, html: PAGE_HTML('Секретная роль') });
    await harness.app.inject({ method: 'POST', url: BASE, headers: { authorization: `Bearer ${harness.tokens['flagged.test']}` },
      payload: { link: 'https://jobs.example.com/a/1?token=abc123' } });
    const log = lines.join('\n');
    expect(log).not.toContain('abc123');
    expect(log).not.toContain('Секретная роль');
  });
});

describe('своя вакансия и подборка', () => {
  it('не появляется в matched-vacancies, прежние маршруты отвечают как раньше', async () => {
    const h = await setup();
    const { id } = (await createText(h)).json().data.vacancy;
    for (const url of ['/api/v1/candidate/matched-vacancies', '/api/v1/candidate/b640/matched-vacancies']) {
      const response = await h.send('GET', url, 'flagged.test');
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(id);
      expect(response.body).not.toContain(SECRET);
    }
  });
});
