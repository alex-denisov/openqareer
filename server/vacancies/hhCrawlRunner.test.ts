import { describe, expect, it, vi } from 'vitest';
import { runHhCrawl, HH_CRAWL_ABANDONED } from './hhCrawlRunner';
import type { HhCrawlPlan } from './hhCrawlPlan';

function statePage(ids: number[]): string {
  const vacancies = ids.map((id) => ({
    vacancyId: id,
    name: `Вакансия ${id}`,
    area: { name: 'Москва' },
    company: { name: 'Компания' },
    compensation: { noCompensation: {} },
    publicationTime: { $: '2026-09-13T10:00:00.000+03:00' },
    links: { desktop: `https://hh.ru/vacancy/${id}` },
    workFormats: [{ workFormatsElement: ['REMOTE'] }],
  }));
  return `<template id="HH-Lux-InitialState">${JSON.stringify({
    vacancySearchResult: { totalResults: ids.length, vacancies },
  }).replaceAll('"', '&#34;')}</template>`;
}

const plan = (pages: number, count = 1): HhCrawlPlan => ({
  queries: Array.from({ length: count }, (_, i) => ({
    roleId: String(96 + i),
    totalResults: pages * 50,
    pages,
    truncated: false,
  })),
  expectedResults: pages * 50 * count,
  expectedPages: pages * count,
  truncatedQueries: 0,
});

const sleep = () => Promise.resolve();

describe('runHhCrawl', () => {
  it('читает все страницы плана и собирает вакансии', async () => {
    let n = 0;
    const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([++n, ++n]) }));

    const result = await runHhCrawl(plan(3), { fetchPage, sleep, searchPeriodDays: 30 });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.vacancies).toHaveLength(6);
    expect(result.pagesRead).toBe(3);
  });

  it('одна и та же вакансия из разных запросов не задваивается', async () => {
    const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([1, 2]) }));

    const result = await runHhCrawl(plan(2, 2), { fetchPage, sleep, searchPeriodDays: 30 });

    expect(fetchPage).toHaveBeenCalledTimes(4);
    expect(result.vacancies).toHaveLength(2);
    expect(result.duplicatesSkipped).toBe(6);
  });

  it('пустая страница обрывает запрос — дальше читать нечего', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: statePage([1]) })
      .mockResolvedValueOnce({ status: 200, body: statePage([]) })
      .mockResolvedValue({ status: 200, body: statePage([9]) });

    const result = await runHhCrawl(plan(5), { fetchPage, sleep, searchPeriodDays: 30 });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.vacancies).toHaveLength(1);
  });

  it('сбой одной страницы не отменяет весь проход', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: statePage([1]) })
      .mockResolvedValueOnce({ status: 500, body: '' })
      .mockResolvedValue({ status: 200, body: statePage([2]) });

    const result = await runHhCrawl(plan(2, 2), { fetchPage, sleep, searchPeriodDays: 30 });

    expect(result.errors).toBe(1);
    expect(result.vacancies.length).toBeGreaterThan(0);
  });

  it('площадка закрылась — проход прекращается, а не долбится дальше', async () => {
    const fetchPage = vi.fn(async () => ({ status: 429, body: '' }));

    await expect(
      runHhCrawl(plan(40, 5), { fetchPage, sleep, searchPeriodDays: 30, refusalLimit: 3 }),
    ).rejects.toThrow(HH_CRAWL_ABANDONED);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('между запросами выдерживается пауза', async () => {
    const paused: number[] = [];
    const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([1]) }));

    await runHhCrawl(plan(3), {
      fetchPage,
      sleep: async (ms) => void paused.push(ms),
      searchPeriodDays: 30,
      delayMs: 1200,
    });

    expect(paused).toEqual([1200, 1200, 1200]);
  });

  it('отмена останавливает проход на ближайшей странице', async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async () => {
      controller.abort();
      return { status: 200, body: statePage([1]) };
    });

    const result = await runHhCrawl(plan(10), {
      fetchPage,
      sleep,
      searchPeriodDays: 30,
      signal: controller.signal,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.stoppedEarly).toBe(true);
  });

  it('о ходе прохода сообщается наружу', async () => {
    const onProgress = vi.fn();
    const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([1]) }));

    await runHhCrawl(plan(2), { fetchPage, sleep, searchPeriodDays: 30, onProgress });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1][0]).toMatchObject({ pagesRead: 2, pagesPlanned: 2 });
  });
});
