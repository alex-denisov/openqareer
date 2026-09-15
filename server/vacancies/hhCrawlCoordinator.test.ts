import { describe, expect, it, vi } from 'vitest';
import {
  HhCrawlCoordinator,
  FULL_SWEEP_INTERVAL_MS,
  PROGRESS_MAX_AGE_MS,
} from './hhCrawlCoordinator';
import type {
  HhCrawlPlanCache,
  HhCrawlProgress,
  HhCrawlSettingsStore,
  HhCrawlSettingsValue,
} from './hhCrawlSettings';

function settingsStore(value: Partial<HhCrawlSettingsValue> = {}) {
  const state: HhCrawlSettingsValue = {
    roleIds: ['96', '124'],
    searchPeriodDays: 30,
    ...value,
  };
  const marked: string[] = [];
  const box: { progress?: HhCrawlProgress; cache?: HhCrawlPlanCache } = {};
  const store: HhCrawlSettingsStore = {
    read: () => state,
    saveRoles: () => undefined,
    markFullSweep: (at) => void marked.push(at),
    requestFullSweep: () => undefined,
    readProgress: () => box.progress,
    saveProgress: (progress) => void (box.progress = progress),
    saveCursor: (cursor, pagesRead, errors) => {
      if (box.progress) box.progress = { ...box.progress, ...cursor, pagesRead, errors };
    },
    clearProgress: () => void (box.progress = undefined),
    readPlanCache: () => box.cache,
    savePlanCache: (cache) => void (box.cache = cache),
  };
  return { store, marked, box };
}

function page(ids: number[]): string {
  const vacancies = ids.map((id) => ({
    vacancyId: id,
    name: `Вакансия ${id}`,
    area: { name: 'Москва' },
    company: { name: 'Компания' },
    compensation: { noCompensation: {} },
    publicationTime: { $: '2026-09-13T10:00:00.000+03:00' },
    links: { desktop: `https://hh.ru/vacancy/${id}` },
    workFormats: [{ workFormatsElement: ['ON_SITE'] }],
  }));
  return `<template id="HH-Lux-InitialState">${JSON.stringify({
    vacancySearchResult: { totalResults: ids.length, vacancies },
  }).replaceAll('"', '&#34;')}</template>`;
}

const okTransport = async () => ({ status: 200, body: page([1, 2]) });
const sleep = () => Promise.resolve();

describe('HhCrawlCoordinator', () => {
  it('без отметки полного прохода делает глубокий обход', async () => {
    const { store, marked } = settingsStore();
    const fetchPage = vi.fn(okTransport);
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    const result = await coordinator.collect();

    expect(result.mode).toBe('full');
    expect(marked).toEqual(['2026-09-13T12:00:00.000Z']);
    expect(result.vacancies.length).toBeGreaterThan(0);
  });

  it('сразу после глубокого прохода делает быстрый', async () => {
    const { store, marked } = settingsStore({
      lastFullSweepAt: '2026-09-13T11:00:00.000Z',
    });
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: vi.fn(okTransport),
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    const result = await coordinator.collect();

    expect(result.mode).toBe('fresh');
    // Быстрый проход отметку не двигает: глубина должна наступить по сроку.
    expect(marked).toEqual([]);
  });

  it('когда срок глубокого прохода вышел — снова глубокий', async () => {
    const last = new Date('2026-09-13T12:00:00.000Z');
    const { store } = settingsStore({ lastFullSweepAt: last.toISOString() });
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: vi.fn(okTransport),
      sleep,
      now: () => new Date(last.getTime() + FULL_SWEEP_INTERVAL_MS + 1),
    });

    expect((await coordinator.collect()).mode).toBe('full');
  });

  it('быстрый проход спрашивает только свежие сутки', async () => {
    const { store } = settingsStore({ lastFullSweepAt: '2026-09-13T11:00:00.000Z' });
    const seen: string[] = [];
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async (url) => {
        seen.push(url);
        return { status: 200, body: page([1]) };
      },
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await coordinator.collect();

    expect(seen.every((url) => new URL(url).searchParams.get('search_period') === '1')).toBe(true);
  });

  it('глубокий проход спрашивает срок из настроек', async () => {
    const { store } = settingsStore({ searchPeriodDays: 14 });
    const seen: string[] = [];
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async (url) => {
        seen.push(url);
        return { status: 200, body: page([1]) };
      },
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await coordinator.collect();

    const periods = new Set(seen.map((url) => new URL(url).searchParams.get('search_period')));
    // Глубокий тик сначала добирает свежие сутки, потом читает по сроку настроек.
    expect(periods).toEqual(new Set(['1', '14']));
  });

  it('обход спрашивает каждую выбранную роль', async () => {
    const { store } = settingsStore({
      roleIds: ['96', '124', '113'],
      lastFullSweepAt: '2026-09-13T11:00:00.000Z',
    });
    const roles = new Set<string>();
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async (url) => {
        roles.add(new URL(url).searchParams.get('professional_role') ?? '');
        return { status: 200, body: page([1]) };
      },
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await coordinator.collect();

    expect([...roles].sort()).toEqual(['113', '124', '96']);
  });

  it('провалившийся глубокий проход отметку не ставит', async () => {
    const { store, marked } = settingsStore();
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async () => ({ status: 429, body: '' }),
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await expect(coordinator.collect()).rejects.toThrow();
    expect(marked).toEqual([]);
  });
});

describe('режим прохода доходит до движка', () => {
  it('и быстрый, и глубокий тик — частичное чтение; снятие невиденных только на последнем', async () => {
    const { buildMultiSourceFetcher } = await import('./multiSourceFetcher');
    const source = {
      id: 'src-hh-search',
      name: 'hh.ru',
      type: 'hh_search' as const,
      enabled: true,
      targetUrl: 'https://hh.ru/search/vacancy',
      refreshIntervalMinutes: 20,
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    };
    const hh = (async () => ({ source: 'hh', vacancies: [] })) as never;
    const remotive = (async () => ({ vacancies: [] })) as never;

    const freshStore = settingsStore({ lastFullSweepAt: '2026-09-13T11:00:00.000Z' });
    const freshFetcher = buildMultiSourceFetcher(
      hh,
      remotive,
      new HhCrawlCoordinator(freshStore.store, {
        fetchPage: okTransport,
        sleep,
        now: () => new Date('2026-09-13T12:00:00.000Z'),
      }),
    );
    const freshReading = await freshFetcher(source);
    expect(Array.isArray(freshReading)).toBe(false);
    expect(freshReading).toMatchObject({ partial: true });
    expect((freshReading as { dropObservedBefore?: string }).dropObservedBefore).toBeUndefined();

    const fullStore = settingsStore();
    const fullFetcher = buildMultiSourceFetcher(
      hh,
      remotive,
      new HhCrawlCoordinator(fullStore.store, {
        fetchPage: okTransport,
        sleep,
        now: () => new Date('2026-09-13T12:00:00.000Z'),
      }),
    );
    const fullReading = await fullFetcher(source);
    expect(fullReading).toMatchObject({
      partial: true,
      dropObservedBefore: '2026-09-13T12:00:00.000Z',
    });
  });
});

describe('глубокий проход по тикам (B219)', () => {
  /** Ответ площадки: замер размера — 120 записей у любой части, страницы — по две записи. */
  function transportWithSizes(perRole = 120) {
    let n = 0;
    const urls: string[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      if (u.searchParams.get('search_period') === '1') return { status: 200, body: page([++n]) };
      return { status: 200, body: sizedPage(perRole, [++n, ++n]) };
    });
    return { fetchPage, urls };
  }

  function sizedPage(totalResults: number, ids: number[]): string {
    return page(ids).replace(
      `totalResults&#34;:${ids.length}`,
      `totalResults&#34;:${totalResults}`,
    );
  }

  const start = new Date('2026-09-15T06:00:00.000Z');

  it('замеры делаются по ролям в пределах бюджета и переживают перезапуск', async () => {
    const { store, box, marked } = settingsStore({ roleIds: ['96', '124', '113'] });
    const { fetchPage, urls } = transportWithSizes();
    let clock = 0;
    const deps = {
      fetchPage,
      sleep,
      now: () => start,
      clock: () => clock,
      tickBudgetMs: 100,
      isKnown: () => true,
    };

    // Первый тик: свежий добор + замер одной роли, потом бюджет кончился.
    fetchPage.mockImplementation(async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      if (u.searchParams.get('search_period') === '1') return { status: 200, body: page([1]) };
      clock += 60;
      return { status: 200, body: sizedPage(120, [2, 3]) };
    });
    const first = await new HhCrawlCoordinator(store, deps).collect();

    expect(first.mode).toBe('full');
    expect(first.finished).toBe(false);
    expect(box.progress).toMatchObject({
      phase: 'planning',
      roleIndex: 2,
      startedAt: start.toISOString(),
    });
    expect(marked).toEqual([]);

    // «Перезапуск»: новый координатор с тем же хранилищем продолжает с третьей роли.
    const seenBefore = urls.length;
    clock = 0;
    const second = await new HhCrawlCoordinator(store, deps).collect();
    const deepRoles = urls
      .slice(seenBefore)
      .filter((u) => new URL(u).searchParams.get('search_period') === '30')
      .map((u) => new URL(u).searchParams.get('professional_role'));
    // Первое глубокое обращение второго тика — замер третьей роли, не первой.
    expect(deepRoles[0]).toBe('113');
    expect(second.mode).toBe('full');
  });

  it('страницы читаются по курсору через несколько тиков; отметка и снятие — на последнем', async () => {
    const { store, box, marked } = settingsStore({ roleIds: ['96'] });
    let clock = 0;
    let n = 100;
    const fetchPage = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get('search_period') === '1') return { status: 200, body: page([1]) };
      clock += 60;
      // Роль в 250 записей — пять страниц.
      return { status: 200, body: sizedPage(250, [++n, ++n]) };
    });
    const deps = {
      fetchPage,
      sleep,
      now: () => start,
      clock: () => clock,
      // Бюджет на две страницы за тик (замер тоже стоит тик времени).
      tickBudgetMs: 100,
      isKnown: () => true,
    };

    const ticks = [];
    for (let i = 0; i < 6 && !(ticks.at(-1)?.finished ?? false); i += 1) {
      clock = 0;
      ticks.push(await new HhCrawlCoordinator(store, deps).collect());
    }

    const last = ticks.at(-1)!;
    expect(last.finished).toBe(true);
    expect(last.dropObservedBefore).toBe(start.toISOString());
    expect(ticks.slice(0, -1).every((t) => t.dropObservedBefore === undefined)).toBe(true);
    expect(marked).toEqual([start.toISOString()]);
    expect(box.progress).toBeUndefined();
    // Готовый план лёг в кэш для следующего прохода.
    expect(box.cache).toMatchObject({ roleIds: ['96'] });
    // Каждый тик отдавал прочитанное, а не копил до конца.
    expect(ticks.every((t) => t.vacancies.length > 0)).toBe(true);
    expect(ticks.length).toBeGreaterThan(2);
  });

  it('незавершённый проход важнее свежей отметки: тик продолжает его', async () => {
    const { store, box } = settingsStore({ lastFullSweepAt: start.toISOString(), roleIds: ['96'] });
    const plan = {
      queries: [{ roleId: '96', totalResults: 100, pages: 2, truncated: false }],
      expectedResults: 100,
      expectedPages: 2,
      truncatedQueries: 0,
    };
    box.progress = {
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: start.toISOString(),
      roleIndex: 1,
      queryIndex: 0,
      page: 1,
      pagesRead: 1,
      errors: 0,
    };
    const urls: string[] = [];
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async (url) => {
        urls.push(url);
        return { status: 200, body: page([7]) };
      },
      sleep,
      now: () => new Date(start.getTime() + 60_000),
    });

    const result = await coordinator.collect();

    expect(result.mode).toBe('full');
    expect(result.finished).toBe(true);
    const deepPages = urls
      .filter((u) => new URL(u).searchParams.get('search_period') === '30')
      .map((u) => new URL(u).searchParams.get('page'));
    // Дочитана только вторая страница — первая была прочитана до перезапуска.
    expect(deepPages).toEqual(['1']);
  });

  it('прогресс старше предела сбрасывается: план протух', async () => {
    const { store, box } = settingsStore({ roleIds: ['96'] });
    box.progress = {
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan: { queries: [], expectedResults: 0, expectedPages: 0, truncatedQueries: 0 },
      startedAt: new Date(start.getTime() - PROGRESS_MAX_AGE_MS - 1).toISOString(),
      roleIndex: 1,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    };
    const { fetchPage } = transportWithSizes();
    const coordinator = new HhCrawlCoordinator(store, { fetchPage, sleep, now: () => start });

    const result = await coordinator.collect();

    expect(result.finished).toBe(true);
    // Проход начался заново: время начала — сейчас, а не протухшее.
    expect(result.dropObservedBefore).toBe(start.toISOString());
  });

  it('свежий кэш плана с тем же набором ролей избавляет от замеров', async () => {
    const { store, box } = settingsStore({ roleIds: ['96'] });
    box.cache = {
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan: {
        queries: [{ roleId: '96', totalResults: 100, pages: 2, truncated: false }],
        expectedResults: 100,
        expectedPages: 2,
        truncatedQueries: 0,
      },
      plannedAt: new Date(start.getTime() - 60_000).toISOString(),
    };
    const { fetchPage, urls } = transportWithSizes();
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    });

    const result = await coordinator.collect();

    expect(result.finished).toBe(true);
    const deep = urls.filter((u) => new URL(u).searchParams.get('search_period') === '30');
    // Ровно две страницы плана, ни одного замера сверх них.
    expect(deep).toHaveLength(2);
  });

  it('кэш плана с другим набором ролей не используется', async () => {
    const { store, box } = settingsStore({ roleIds: ['96', '124'] });
    box.cache = {
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan: { queries: [], expectedResults: 0, expectedPages: 0, truncatedQueries: 0 },
      plannedAt: start.toISOString(),
    };
    const { fetchPage, urls } = transportWithSizes();

    await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    }).collect();

    const counted = new Set(
      urls
        .filter((u) => new URL(u).searchParams.get('search_period') === '30')
        .map((u) => new URL(u).searchParams.get('professional_role')),
    );
    expect(counted).toEqual(new Set(['96', '124']));
  });

  it('один сбой замера не рушит план: замер повторяется', async () => {
    const { store } = settingsStore({ roleIds: ['96'] });
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(async () => ({ status: 200, body: page([1]) })) // свежий добор
      .mockImplementationOnce(async () => ({ status: 0, body: '' }))
      .mockImplementation(async () => ({ status: 200, body: sizedPage(100, [2, 3]) }));

    const result = await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    }).collect();

    expect(result.finished).toBe(true);
  });

  it('замер, отказавший несколько раз подряд, останавливает тик, но прогресс остаётся', async () => {
    const { store, box } = settingsStore({ roleIds: ['96', '124'] });
    let counted = 0;
    const fetchPage = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get('search_period') === '1') return { status: 200, body: page([1]) };
      counted += 1;
      // Первая роль замеряется, вторая — отказывает всегда.
      if (u.searchParams.get('professional_role') === '96') {
        return { status: 200, body: sizedPage(100, [2, 3]) };
      }
      return { status: 0, body: '' };
    });

    await expect(
      new HhCrawlCoordinator(store, {
        fetchPage,
        sleep,
        now: () => start,
        isKnown: () => true,
      }).collect(),
    ).rejects.toThrow('hh_crawl_abandoned');
    expect(box.progress).toMatchObject({ phase: 'planning', roleIndex: 1 });
    expect(counted).toBeGreaterThan(2);
  });

  it('свежий добор тоже живёт в бюджете тика: холодный пул не растягивает тик на часы', async () => {
    const { store } = settingsStore({
      lastFullSweepAt: start.toISOString(),
      roleIds: ['96', '124'],
    });
    let clock = 0;
    let n = 0;
    const fetchPage = vi.fn(async () => {
      clock += 60;
      return { status: 200, body: page([++n]) };
    });

    const result = await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      clock: () => clock,
      tickBudgetMs: 150,
      isKnown: () => false,
    }).collect();

    // Всё новое, стоп-правило не срабатывает; остановил именно бюджет.
    expect(result.mode).toBe('fresh');
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('проход с непрочитанными страницами не снимает невиденное', async () => {
    const { store, marked } = settingsStore({ roleIds: ['96'] });
    let n = 0;
    let deepPages = 0;
    const fetchPage = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get('search_period') === '1') return { status: 200, body: page([1]) };
      deepPages += 1;
      // Замер и первые страницы отвечают; одна страница отказывает и на повторе.
      if (deepPages === 4 || deepPages === 5) return { status: 500, body: '' };
      return { status: 200, body: sizedPage(250, [++n, ++n]) };
    });

    const result = await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    }).collect();

    expect(result.finished).toBe(true);
    expect(result.errors).toBe(1);
    expect(result.dropObservedBefore).toBeUndefined();
    // Отметка при этом стоит: проход дошёл до конца, повторять его не нужно.
    expect(marked).toEqual([start.toISOString()]);
  });

  it('ошибки прежних тиков учитываются: снятия нет, даже если последний тик чист', async () => {
    const { store, box } = settingsStore({ roleIds: ['96'] });
    box.progress = {
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan: {
        queries: [{ roleId: '96', totalResults: 100, pages: 2, truncated: false }],
        expectedResults: 100,
        expectedPages: 2,
        truncatedQueries: 0,
      },
      startedAt: start.toISOString(),
      roleIndex: 1,
      queryIndex: 0,
      page: 1,
      pagesRead: 0,
      errors: 1,
    };
    const { fetchPage } = transportWithSizes();

    const result = await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    }).collect();

    expect(result.finished).toBe(true);
    expect(result.dropObservedBefore).toBeUndefined();
  });

  it('усечённая часть плана запрещает снятие: невиденное там живо', async () => {
    const { store, box } = settingsStore({ roleIds: ['96'] });
    box.progress = {
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan: {
        queries: [{ roleId: '96', totalResults: 5000, pages: 1, truncated: true }],
        expectedResults: 2000,
        expectedPages: 1,
        truncatedQueries: 1,
      },
      startedAt: start.toISOString(),
      roleIndex: 1,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    };
    const { fetchPage } = transportWithSizes();

    const result = await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    }).collect();

    expect(result.finished).toBe(true);
    expect(result.dropObservedBefore).toBeUndefined();
  });

  it('прогресс, построенный по другому набору ролей, сбрасывается', async () => {
    const { store, box } = settingsStore({ roleIds: ['96', '124'] });
    box.progress = {
      phase: 'planning',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan: { queries: [], expectedResults: 0, expectedPages: 0, truncatedQueries: 0 },
      startedAt: start.toISOString(),
      roleIndex: 1,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    };
    const { fetchPage, urls } = transportWithSizes();

    await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    }).collect();

    const counted = new Set(
      urls
        .filter((u) => new URL(u).searchParams.get('search_period') === '30')
        .map((u) => new URL(u).searchParams.get('professional_role')),
    );
    // Обе роли замерены заново, а не «продолжено со второй».
    expect(counted).toEqual(new Set(['96', '124']));
  });

  it('кэш плана с другим сроком не используется', async () => {
    const { store, box } = settingsStore({ roleIds: ['96'], searchPeriodDays: 7 });
    box.cache = {
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan: { queries: [], expectedResults: 0, expectedPages: 0, truncatedQueries: 0 },
      plannedAt: start.toISOString(),
    };
    const { fetchPage, urls } = transportWithSizes();

    await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      isKnown: () => true,
    }).collect();

    // Пустой кэш на 30 дней не подошёл: роль замерена по сроку 7 дней.
    expect(urls.some((u) => new URL(u).searchParams.get('search_period') === '7')).toBe(true);
  });

  it('курсор двигается раз в тик, после чтения, а не на каждой странице', async () => {
    const { store, box } = settingsStore({ roleIds: ['96'] });
    let clock = 0;
    let n = 0;
    const cursorsSeen: number[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get('search_period') === '1') return { status: 200, body: page([1]) };
      cursorsSeen.push(box.progress?.page ?? -1);
      clock += 60;
      return { status: 200, body: sizedPage(250, [++n, ++n]) };
    });

    await new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => start,
      clock: () => clock,
      tickBudgetMs: 200,
      isKnown: () => true,
    }).collect();

    // Во время чтения страниц курсор в базе стоял на нуле; сдвинулся после тика.
    expect(cursorsSeen.every((p) => p === 0)).toBe(true);
    expect(box.progress?.page).toBeGreaterThan(0);
  });
});
