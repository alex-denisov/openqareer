import { describe, expect, it } from 'vitest';
import { pagingPlanFor, rotatingWindowStart } from './pagedJsonSources';

/**
 * B216 — у каждой постраничной площадки своя механика продолжения. План
 * обязан остановиться ровно там, где площадка отдала всё, и не просить
 * страницу за пределами выдачи.
 */
describe('paging plans (B216)', () => {
  it('TheMuse: начинает с окна, сдвинутого от времени, и останавливается на page_count', () => {
    const plan = pagingPlanFor('src-themuse')!;
    const url = 'https://www.themuse.com/api/public/jobs?page=1&category=IT';

    const first = plan.first(url, 0);
    expect(new URL(first.url).searchParams.get('page')).toBe('1');

    const laterWindow = plan.first(url, 60 * 60_000);
    expect(new URL(laterWindow.url).searchParams.get('page')).toBe('61');

    const next = plan.next(first, { page_count: 2, results: [{}] });
    expect(next && new URL(next.url).searchParams.get('page')).toBe('2');
    expect(plan.next(next!, { page_count: 2, results: [{}] })).toBeNull();
    expect(plan.next(first, { page_count: 9, results: [] })).toBeNull();
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
    const next = plan.next(first, { total: 45, jobPostings: [{}] });
    expect(next?.body).toMatchObject({ offset: 20 });
    const third = plan.next(next!, { total: 45, jobPostings: [{}] });
    expect(third?.body).toMatchObject({ offset: 40 });
    expect(plan.next(third!, { total: 45, jobPostings: [{}] })).toBeNull();
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
