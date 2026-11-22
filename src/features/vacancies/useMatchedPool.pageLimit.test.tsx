// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatchedVacancyPage } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { MatchedVacancyPage } from '../coach/matchedVacancyApi';
import { useMatchedPool, type MatchedPool } from './useMatchedPool';

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

async function readPool(options?: { readonly pageLimit: number }): Promise<MatchedPool> {
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

  it('без ограничения прежнее чтение — все страницы (старый кабинет)', async () => {
    const pool = await readPool();
    expect(vi.mocked(getMatchedVacancyPage)).toHaveBeenCalledTimes(TOTAL / 20);
    expect(pool.complete).toBe(true);
  });
});
