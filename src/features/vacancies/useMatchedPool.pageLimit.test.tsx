// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatchedVacancyFacets, getMatchedVacancyPage } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { MatchedVacancyPage } from '../coach/matchedVacancyApi';
import { writeCachedMatchedPool } from './matchedPoolCache';
import { useMatchedPool, type MatchedPool, type MatchedPoolOptions } from './useMatchedPool';

vi.mock('../coach/coachApi', () => ({
  getMatchedVacancyPage: vi.fn(),
  getMatchedVacancyFacets: vi.fn().mockResolvedValue(undefined),
  getVacancySources: vi.fn().mockResolvedValue([]),
}));
vi.mock('./matchedPoolCache', () => ({
  readCachedMatchedPool: () => undefined,
  writeCachedMatchedPool: vi.fn(),
}));

const TOTAL = 1_660;
const row = (index: number) => ({ cluster: { id: `v-${index}` } }) as unknown as MatchedVacancyItem;
const pageAt = (offset: number): MatchedVacancyPage => ({
  items: Array.from({ length: 20 }, (_, index) => row(offset + index)),
  total: TOTAL,
  nextOffset: offset + 20 < TOTAL ? offset + 20 : null,
  pageOffsets: Array.from({ length: TOTAL / 20 }, (_, index) => index * 20),
});

async function readPool(options?: MatchedPoolOptions): Promise<MatchedPool> {
  vi.mocked(getMatchedVacancyPage).mockImplementation(async (offset) => pageAt(offset ?? 0));
  let pool!: MatchedPool;
  function Reader() {
    pool = useMatchedPool(undefined, options);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Reader />));
  await act(async () => undefined);
  const result = pool;
  await act(async () => root.unmount());
  return result;
}

describe('B645 s07: подборка не читает весь список до первых 20 строк', () => {
  afterEach(() => vi.clearAllMocks());

  it('pageLimit 1 — один запрос строк, число из ответа сервера, подборка не полная', async () => {
    const pool = await readPool({ pageLimit: 1 });
    expect(vi.mocked(getMatchedVacancyPage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getMatchedVacancyPage).mock.calls[0]?.[0]).toBe(0);
    expect(pool).toMatchObject({ total: TOTAL, complete: false, loading: false, failed: false });
    expect(pool.matched).toHaveLength(20);
  });

  it('своя первая страница — один запрос: роли, фасеты и кампания из неё, кэш только последний', async () => {
    const firstPage = vi.fn(async () => ({
      ...pageAt(0),
      pageOffsets: undefined,
      facets: {} as MatchedVacancyPage['facets'],
      initialFilters: { roles: ['CTO'], regions: [], remoteOnly: false },
    }));
    const pool = await readPool({ pageLimit: 1, firstPage });
    expect(firstPage).toHaveBeenCalledTimes(1);
    expect(firstPage).toHaveBeenCalledWith(expect.anything());
    expect(getMatchedVacancyPage).not.toHaveBeenCalled();
    expect(getMatchedVacancyFacets).not.toHaveBeenCalled();
    expect(pool).toMatchObject({ readRoles: ['CTO'], total: TOTAL, complete: false });
    expect(vi.mocked(writeCachedMatchedPool).mock.lastCall?.[1]).toBe('latest');
  });

  it('снятые роли читаются явно, без подстановки сервера', async () => {
    const firstPage = vi.fn(async () => ({ ...pageAt(0), facets: {} as MatchedVacancyPage['facets'] }));
    let pool!: MatchedPool;
    function Reader() {
      pool = useMatchedPool(undefined, { pageLimit: 1, firstPage });
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Reader />));
    const none = { roles: [], regions: [], remoteOnly: false };
    await act(async () => pool.setFilters?.(none));
    expect(firstPage).toHaveBeenLastCalledWith(expect.anything(), none);
    expect(pool.readRoles).toEqual([]);
    await act(async () => root.unmount());
  });

  it('без ограничения прежнее чтение — все страницы (старый кабинет)', async () => {
    const pool = await readPool();
    expect(vi.mocked(getMatchedVacancyPage)).toHaveBeenCalledTimes(TOTAL / 20);
    expect(pool.complete).toBe(true);
  });
});

describe('B792: роли, которые ставит сам экран, не опустошают список', () => {
  afterEach(() => vi.clearAllMocks());

  async function narrowed(keepRows: boolean, answer: Promise<MatchedVacancyPage>) {
    vi.mocked(getMatchedVacancyPage).mockResolvedValueOnce(pageAt(0)).mockReturnValueOnce(answer);
    let pool!: MatchedPool;
    function Reader() {
      pool = useMatchedPool(undefined, { pageLimit: 1 });
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Reader />));
    await act(async () => undefined);
    await act(async () =>
      pool.setFilters?.({ roles: ['CTO'], regions: [], remoteOnly: false }, keepRows),
    );
    return { root, read: () => pool };
  }

  it('строки остаются до ответа и заменяются разом; выбор кандидата — как прежде', async () => {
    let done!: (page: MatchedVacancyPage) => void;
    const answer = new Promise<MatchedVacancyPage>((resolve) => (done = resolve));
    const own = await narrowed(true, answer);
    expect(own.read()).toMatchObject({ loading: false, reading: true });
    expect(own.read().matched).toHaveLength(20);
    await act(async () => done({ ...pageAt(100), total: 7 }));
    expect(own.read().matched[0]?.cluster.id).toBe('v-100');
    expect(own.read().total).toBe(7);
    await act(async () => own.root.unmount());

    const picked = await narrowed(false, new Promise(() => undefined));
    expect(picked.read()).toMatchObject({ loading: true, matched: [] });
    await act(async () => picked.root.unmount());
  });

  it('сужение не прочиталось — ошибка, а не молчаливый прежний список', async () => {
    const answer = Promise.reject(new Error('сбой'));
    answer.catch(() => undefined);
    const own = await narrowed(true, answer);
    expect(own.read().failed).toBe(true);
    await act(async () => own.root.unmount());
  });
});
