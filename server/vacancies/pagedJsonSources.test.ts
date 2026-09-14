import { describe, expect, it } from 'vitest';
import { getonbrdCategories, pagingPlanFor, rotatingWindowStart, themuseQueries } from './pagedJsonSources';


/**
 * B216 — у каждой постраничной площадки своя механика продолжения. План
 * обязан остановиться ровно там, где площадка отдала всё, и не просить
 * страницу за пределами выдачи.
 */
/** Ближайший такт (шаг 4 ч), на котором окно стартует с начала. */
function tickWhere(from: number, ok: (t: number) => boolean): number {
  for (let t = from; t < from + 24 * 240 * 60_000; t += 240 * 60_000) if (ok(t)) return t;
  throw new Error('no tick found');
}

describe('paging plans (B216)', () => {
  it('TheMuse: веер «категория × уровень», страница не выше 99, комбинации по кругу', () => {
    const plan = pagingPlanFor('src-themuse')!;
    const url = 'https://www.themuse.com/api/public/jobs?page=1&category=IT&category=Sales';
    expect(themuseQueries(url)).toHaveLength(10);

    const first = plan.first(url, 0);
    const firstParams = new URL(first.url).searchParams;
    expect(firstParams.getAll('category')).toEqual(['IT']);
    expect(firstParams.get('level')).toBe('Internship');
    expect(firstParams.get('page')).toBe('1');

    const later = plan.first(url, 30 * 60_000);
    expect(new URL(later.url).searchParams.get('level')).toBe('Entry Level');

    const next = plan.next(first, { page_count: 500, results: [{}] });
    expect(new URL(next!.url).searchParams.get('page')).toBe('2');

    const atCap = { ...first, url: first.url.replace('page=1', 'page=99') };
    const rolled = plan.next(atCap, { page_count: 500, results: [{}] });
    const rolledParams = new URL(rolled!.url).searchParams;
    expect(rolledParams.get('page')).toBe('1');
    expect(rolledParams.get('level')).toBe('Entry Level');

    const empty = plan.next(first, { page_count: 500, results: [] });
    expect(new URL(empty!.url).searchParams.get('level')).toBe('Entry Level');
  });

  it('Himalayas: следует за nextCursor, пока есть записи', () => {
    const plan = pagingPlanFor('src-himalayas-api')!;
    const first = plan.first('https://himalayas.app/jobs/api?limit=20', 0);
    const next = plan.next(first, { nextCursor: 'abc', jobs: [{}] });
    expect(next?.url).toBe('https://himalayas.app/jobs/api?limit=20&cursor=abc');
    expect(plan.next(first, { nextCursor: '', jobs: [{}] })).toBeNull();
    expect(plan.next(first, { nextCursor: 'abc', jobs: [] })).toBeNull();
  });

  it('Amazon: шагает смещением на result_limit до hits', () => {
    const plan = pagingPlanFor('src-amazon-jobs')!;
    const first = plan.first('https://www.amazon.jobs/en/search.json?result_limit=100', 0);
    expect(new URL(first.url).searchParams.get('offset')).toBe('0');
    const next = plan.next(first, { hits: 250, jobs: [{}] });
    expect(new URL(next!.url).searchParams.get('offset')).toBe('100');
    const third = plan.next(next!, { hits: 250, jobs: [{}] });
    expect(new URL(third!.url).searchParams.get('offset')).toBe('200');
    expect(plan.next(third!, { hits: 250, jobs: [{}] })).toBeNull();
  });

  it('Eightfold: шагает start на num до count', () => {
    const plan = pagingPlanFor('src-netflix')!;
    const first = plan.first('https://x.example/api/apply/v2/jobs?domain=x.com&num=10', 0);
    const next = plan.next(first, { count: 15, positions: [{}] });
    expect(new URL(next!.url).searchParams.get('start')).toBe('10');
    expect(plan.next(next!, { count: 15, positions: [{}] })).toBeNull();
  });

  it('Workday: POST со смещением по 20 до total', () => {
    const plan = pagingPlanFor('ats-workday-nvidia')!;
    const first = plan.first('https://t.wd5.myworkdayjobs.com/wday/cxs/t/Site/jobs', 0);
    expect(first.method).toBe('POST');
    expect(first.body).toMatchObject({ limit: 20, offset: 0 });
    const page = Array.from({ length: 20 }, () => ({}));
    const next = plan.next(first, { total: 45, jobPostings: page });
    expect(next?.body).toMatchObject({ offset: 20 });
    // Дальше первой страницы Workday отдаёт total = 0 — план помнит его сам.
    const third = plan.next(next!, { total: 0, jobPostings: page });
    expect(third?.body).toMatchObject({ offset: 40 });
    expect(plan.next(third!, { total: 0, jobPostings: page })).toBeNull();
    expect(plan.next(first, { total: 45, jobPostings: [{}] })).toBeNull();
  });

  it('Apple: POST по 20, окно по кругу, за границей свежести — заворот к началу, полный круг — стоп (B217)', () => {
    const plan = pagingPlanFor('src-apple-jobs')!;
    const url = 'https://jobs.apple.com/api/v1/search';
    const now = tickWhere(Date.parse('2026-09-14T09:00:00Z'), (t) => (plan.first(url, t).body as { page: number }).page === 1);
    const first = plan.first(url, now);
    expect(first.method).toBe('POST');
    expect(first.body).toMatchObject({ page: 1, sort: 'newest', locale: 'en-us' });
    // Без `format` площадка отдаёт пустую выдачу (замер 2026-09-14).
    expect(first.body).toHaveProperty('format');
    const page = (date: string) => Array.from({ length: 20 }, () => ({ postDateInGMT: date }));
    const fresh = { res: { totalRecords: 6081, searchResults: page('2026-09-13T00:00:00Z') } };
    const stale = { res: { totalRecords: 6081, searchResults: page('2026-08-01T00:00:00Z') } };
    // Другой такт — другая стартовая страница: бюджет — порция, а не потолок.
    const later = plan.first(url, now + 240 * 60_000);
    const startPage = (later.body as { page: number }).page;
    expect(startPage).toBeGreaterThan(1);
    const next = plan.next(later, fresh);
    expect(next?.body).toMatchObject({ page: startPage + 1 });
    // Хвост страницы старше 30 дней — заворот на первую страницу, чтение ещё не полное.
    const wrapped = plan.next(next!, stale);
    expect(wrapped?.body).toMatchObject({ page: 1 });
    // Дошли до своей стартовой — круг замкнут, чтение полное.
    let cursor = wrapped!;
    for (let i = 1; i < startPage - 1; i += 1) cursor = plan.next(cursor, fresh)!;
    expect(cursor.body).toMatchObject({ page: startPage - 1 });
    expect(plan.next(cursor, fresh)).toBeNull();
    // Со старта с первой страницы граница свежести — конец.
    const fromStart = first;
    expect(plan.next(fromStart, stale)).toBeNull();
    expect(plan.next(fromStart, { res: { totalRecords: 20, searchResults: page('2026-09-13T00:00:00Z') } })).toBeNull();
    expect(plan.next(fromStart, { res: { totalRecords: 6081, searchResults: [] } })).toBeNull();
  });

  it('Microsoft: Eightfold под `data`, окно по кругу до границы свежести, пауза не короче секунды (B217)', () => {
    const plan = pagingPlanFor('src-microsoft-careers')!;
    const url = 'https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&num=10';
    const now = tickWhere(Date.now(), (t) => new URL(plan.first(url, t).url).searchParams.get('start') === '0');
    const first = plan.first(url, now);
    expect(new URL(first.url).searchParams.get('start')).toBe('0');
    // 429 на проде при 300 мс между страницами (2026-09-14).
    expect(plan.delayMs).toBeGreaterThanOrEqual(1000);
    const freshTs = Math.floor(Date.now() / 1000) - 86_400;
    const fresh = { data: { count: 2215, positions: [{ postedTs: freshTs }] } };
    const stale = { data: { count: 2215, positions: [{ postedTs: freshTs - 40 * 86_400 }] } };
    const next = plan.next(first, fresh);
    expect(new URL(next!.url).searchParams.get('start')).toBe('10');
    expect(plan.next(next!, stale)).toBeNull();
    expect(plan.next(first, { data: { count: 5, positions: [{ postedTs: freshTs }] } })).toBeNull();
    expect(plan.next(first, { data: { count: 2215, positions: [] } })).toBeNull();
    const later = plan.first(url, now + 240 * 60_000);
    const start = Number(new URL(later.url).searchParams.get('start'));
    expect(start).toBeGreaterThan(0);
    const wrapped = plan.next(later, stale);
    expect(new URL(wrapped!.url).searchParams.get('start')).toBe('0');
  });

  it('Get on Board: веер по категориям, страницы по meta.total_pages, категории по кругу (B217)', () => {
    const plan = pagingPlanFor('src-getonbrd')!;
    const url = 'https://www.getonbrd.com/api/v0/categories/programming/jobs?per_page=100&expand=%5B%22company%22%5D';
    const first = plan.first(url, 0);
    expect(new URL(first.url).pathname).toBe('/api/v0/categories/programming/jobs');
    expect(new URL(first.url).searchParams.get('page')).toBe('1');
    const next = plan.next(first, { meta: { page: 1, per_page: 100, total_pages: 4 }, data: [{}] });
    expect(new URL(next!.url).searchParams.get('page')).toBe('2');
    const last = plan.next({ ...first, url: next!.url.replace('page=2', 'page=4') }, { meta: { total_pages: 4 }, data: [{}] });
    expect(new URL(last!.url).pathname).not.toBe('/api/v0/categories/programming/jobs');
    expect(new URL(last!.url).searchParams.get('page')).toBe('1');
    expect(getonbrdCategories().length).toBeGreaterThanOrEqual(17);
  });

  it('Indeed: POST graphql с курсором, стоп на пустом nextCursor или пустой выдаче (B218)', () => {
    const plan = pagingPlanFor('src-indeed')!;
    const first = plan.first('https://apis.indeed.com/graphql', 0);
    expect(first.method).toBe('POST');
    expect(first.headers?.['indeed-api-key']).toBeTruthy();
    expect((first.body as { query: string }).query).toContain('jobSearch');
    const payload = { data: { jobSearch: { pageInfo: { nextCursor: 'cur2' }, results: [{ job: {} }] } } };
    const next = plan.next(first, payload);
    expect((next!.body as { query: string }).query).toContain('cursor: "cur2"');
    expect(plan.next(first, { data: { jobSearch: { pageInfo: { nextCursor: '' }, results: [{ job: {} }] } } })).toBeNull();
    expect(plan.next(first, { data: { jobSearch: { pageInfo: { nextCursor: 'x' }, results: [] } } })).toBeNull();
  });

  it('у площадки без плана плана нет', () => {
    expect(pagingPlanFor('src-arbeitnow')).toBeNull();
  });

  it('окно обходит весь диапазон по кругу', () => {
    const starts = new Set<number>();
    for (let tick = 0; tick < 5; tick += 1) {
      starts.add(rotatingWindowStart(tick * 60 * 60_000, 60, 10, 50));
    }
    expect([...starts].sort((a, b) => a - b)).toEqual([1, 11, 21, 31, 41]);
    expect(rotatingWindowStart(5 * 60 * 60_000, 60, 10, 50)).toBe(1);
  });
});
