import { describe, expect, it } from 'vitest';
import { getonbrdCategories, pagingPlanFor, rotatingWindowStart, themuseQueries } from './pagedJsonSources';


/**
 * B216 — у каждой постраничной площадки своя механика продолжения. План
 * обязан остановиться ровно там, где площадка отдала всё, и не просить
 * страницу за пределами выдачи.
 */
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

  it('Apple: POST по 20 от свежих, стоп на границе 30 дней или на последней странице (B217)', () => {
    const plan = pagingPlanFor('src-apple-jobs')!;
    const url = 'https://jobs.apple.com/api/v1/search';
    const now = Date.parse('2026-09-14T09:00:00Z');
    const first = plan.first(url, now);
    expect(first.method).toBe('POST');
    expect(first.body).toMatchObject({ page: 1, sort: 'newest', locale: 'en-us' });
    // Без `format` площадка отдаёт пустую выдачу (замер 2026-09-14).
    expect(first.body).toHaveProperty('format');
    const page = (date: string) => Array.from({ length: 20 }, () => ({ postDateInGMT: date }));
    const next = plan.next(first, { res: { totalRecords: 6081, searchResults: page('2026-09-13T00:00:00Z') } });
    expect(next?.body).toMatchObject({ page: 2 });
    // Страница, чей хвост старше 30 дней, — последняя: дальше пул ничего не примет.
    expect(plan.next(next!, { res: { totalRecords: 6081, searchResults: page('2026-08-01T00:00:00Z') } })).toBeNull();
    expect(plan.next(next!, { res: { totalRecords: 40, searchResults: page('2026-09-13T00:00:00Z') } })).toBeNull();
    expect(plan.next(first, { res: { totalRecords: 6081, searchResults: [] } })).toBeNull();
  });

  it('Microsoft: Eightfold под `data` от свежих, стоп на границе 30 дней, пауза не короче секунды (B217)', () => {
    const plan = pagingPlanFor('src-microsoft-careers')!;
    const url = 'https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&num=10';
    const first = plan.first(url, 0);
    expect(new URL(first.url).searchParams.get('start')).toBe('0');
    // 429 на проде при 300 мс между страницами (2026-09-14).
    expect(plan.delayMs).toBeGreaterThanOrEqual(1000);
    const fresh = Math.floor(Date.now() / 1000) - 86_400;
    const next = plan.next(first, { data: { count: 2215, positions: [{ postedTs: fresh }] } });
    expect(new URL(next!.url).searchParams.get('start')).toBe('10');
    expect(plan.next(next!, { data: { count: 2215, positions: [{ postedTs: fresh - 40 * 86_400 }] } })).toBeNull();
    expect(plan.next(first, { data: { count: 5, positions: [{ postedTs: fresh }] } })).toBeNull();
    expect(plan.next(first, { data: { count: 2215, positions: [] } })).toBeNull();
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
