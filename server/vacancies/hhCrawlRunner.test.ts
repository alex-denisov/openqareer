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
      .mockResolvedValueOnce({ status: 500, body: '' })
      .mockResolvedValue({ status: 200, body: statePage([2]) });

    const result = await runHhCrawl(plan(2, 2), { fetchPage, sleep, searchPeriodDays: 30 });

    expect(result.errors).toBe(1);
    expect(result.vacancies.length).toBeGreaterThan(0);
  });

  it('упавшая страница повторяется один раз, и удачный повтор — не ошибка (B219)', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, body: '' })
      .mockResolvedValue({ status: 200, body: statePage([1]) });

    const result = await runHhCrawl(plan(1), { fetchPage, sleep, searchPeriodDays: 30 });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.errors).toBe(0);
    expect(result.vacancies).toHaveLength(1);
  });

  it('площадка закрылась — проход прекращается, а не долбится дальше', async () => {
    const fetchPage = vi.fn(async () => ({ status: 429, body: '' }));

    await expect(
      runHhCrawl(plan(40, 5), { fetchPage, sleep, searchPeriodDays: 30, refusalLimit: 3 }),
    ).rejects.toThrow(HH_CRAWL_ABANDONED);
    // Три отказа подряд, у каждого один повтор.
    expect(fetchPage).toHaveBeenCalledTimes(6);
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

  describe('курсор и бюджет тика (B219)', () => {
    it('начинает с переданного курсора, а не с начала плана', async () => {
      const urls: string[] = [];
      const fetchPage = vi.fn(async (url: string) => {
        urls.push(url);
        return { status: 200, body: statePage([1]) };
      });

      const result = await runHhCrawl(plan(3, 2), {
        fetchPage,
        sleep,
        searchPeriodDays: 30,
        start: { queryIndex: 1, page: 2 },
      });

      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(urls[0]).toContain('professional_role=97');
      expect(urls[0]).toContain('page=2');
      expect(result.finished).toBe(true);
    });

    it('по истечении бюджета останавливается и называет место, с которого продолжать', async () => {
      let tick = 0;
      const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([++tick]) }));

      const result = await runHhCrawl(plan(3, 2), {
        fetchPage,
        sleep,
        searchPeriodDays: 30,
        clock: () => tick * 1_000,
        deadlineMs: 2_500,
      });

      // Прочитаны страницы 0, 1, 2 первой части — часы показали 3 000 ≥ 2 500.
      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(result.finished).toBe(false);
      expect(result.stoppedEarly).toBe(false);
      expect(result.cursor).toEqual({ queryIndex: 1, page: 0 });
    });

    it('курсор сообщается после каждой страницы', async () => {
      const cursors: { queryIndex: number; page: number }[] = [];
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, body: statePage([1]) })
        .mockResolvedValueOnce({ status: 200, body: statePage([]) })
        .mockResolvedValue({ status: 200, body: statePage([2]) });

      const result = await runHhCrawl(plan(3, 2), {
        fetchPage,
        sleep,
        searchPeriodDays: 30,
        onCursor: (cursor) => void cursors.push(cursor),
      });

      // Пустая страница обрывает первую часть: курсор перескакивает на вторую.
      expect(cursors).toEqual([
        { queryIndex: 0, page: 1 },
        { queryIndex: 1, page: 0 },
        { queryIndex: 1, page: 1 },
        { queryIndex: 1, page: 2 },
        { queryIndex: 2, page: 0 },
      ]);
      expect(result.finished).toBe(true);
      expect(result.cursor).toEqual({ queryIndex: 2, page: 0 });
    });

    it('полная последняя плановая страница — чтение идёт дальше плана до пустой', async () => {
      // План насчитал две страницы, а часть подросла: третья страница есть.
      const full = Array.from({ length: 50 }, (_, i) => i + 1);
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, body: statePage(full) })
        .mockResolvedValueOnce({ status: 200, body: statePage(full.map((i) => i + 50)) })
        .mockResolvedValueOnce({ status: 200, body: statePage([101, 102]) })
        .mockResolvedValue({ status: 200, body: statePage([999]) });

      const result = await runHhCrawl(plan(2), { fetchPage, sleep, searchPeriodDays: 30 });

      // Третья страница неполная — на ней чтение части и заканчивается.
      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(result.vacancies).toHaveLength(102);
      expect(result.finished).toBe(true);
    });

    it('часть без страниц пропускается, а не зацикливает проход', async () => {
      const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([1]) }));
      const emptyThenOne: HhCrawlPlan = {
        queries: [
          { roleId: '96', totalResults: 0, pages: 0, truncated: false },
          { roleId: '97', totalResults: 50, pages: 1, truncated: false },
        ],
        expectedResults: 50,
        expectedPages: 1,
        truncatedQueries: 0,
      };

      const result = await runHhCrawl(emptyThenOne, { fetchPage, sleep, searchPeriodDays: 30 });

      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(result.finished).toBe(true);
    });

    it('отмена тоже возвращает курсор на недочитанную страницу', async () => {
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

      expect(result.finished).toBe(false);
      expect(result.cursor).toEqual({ queryIndex: 0, page: 1 });
    });
  });

  describe('быстрый проход: стоп на странице без новых id (B219)', () => {
    const freshPlan = (pages: number, stopAfter: number): HhCrawlPlan => ({
      queries: [
        {
          roleId: '96',
          totalResults: pages * 50,
          pages,
          truncated: false,
          stopWhenNothingNewAfter: stopAfter,
        },
      ],
      expectedResults: pages * 50,
      expectedPages: pages,
      truncatedQueries: 0,
    });

    it('страница, где все id уже известны пулу, обрывает часть — но не раньше минимума', async () => {
      const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([1, 2]) }));
      const known = new Set(['src-hh-search:1', 'src-hh-search:2']);

      const result = await runHhCrawl(freshPlan(40, 3), {
        fetchPage,
        sleep,
        searchPeriodDays: 1,
        isKnown: (id) => known.has(id),
      });

      expect(fetchPage).toHaveBeenCalledTimes(3);
      expect(result.finished).toBe(true);
    });

    it('пока на странице есть хоть один новый id, чтение продолжается', async () => {
      let n = 0;
      const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([++n, 1000]) }));

      await runHhCrawl(freshPlan(6, 3), {
        fetchPage,
        sleep,
        searchPeriodDays: 1,
        isKnown: (id) => id === 'src-hh-search:1000',
      });

      expect(fetchPage).toHaveBeenCalledTimes(6);
    });

    it('дубль внутри тика, неизвестный пулу, считается новым для правила остановки', async () => {
      // Две роли делят одну вакансию 1; пул её не знает. Вторая роль не должна
      // оборваться на первой странице только потому, что тик уже поймал её.
      const twoRoles: HhCrawlPlan = {
        queries: [
          {
            roleId: '96',
            totalResults: 50,
            pages: 1,
            truncated: false,
            stopWhenNothingNewAfter: 1,
          },
          {
            roleId: '97',
            totalResults: 100,
            pages: 2,
            truncated: false,
            stopWhenNothingNewAfter: 1,
          },
        ],
        expectedResults: 150,
        expectedPages: 3,
        truncatedQueries: 0,
      };
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, body: statePage([1]) })
        .mockResolvedValueOnce({ status: 200, body: statePage([1]) })
        .mockResolvedValue({ status: 200, body: statePage([2]) });

      await runHhCrawl(twoRoles, { fetchPage, sleep, searchPeriodDays: 1, isKnown: () => false });

      expect(fetchPage).toHaveBeenCalledTimes(3);
    });

    it('без правила остановки известные id ничего не меняют', async () => {
      const fetchPage = vi.fn(async () => ({ status: 200, body: statePage([1]) }));

      await runHhCrawl(plan(4), {
        fetchPage,
        sleep,
        searchPeriodDays: 30,
        isKnown: () => true,
      });

      expect(fetchPage).toHaveBeenCalledTimes(4);
    });
  });
});
