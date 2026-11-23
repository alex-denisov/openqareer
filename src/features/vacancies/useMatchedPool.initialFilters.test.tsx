// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatchedVacancyPage } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { MatchedVacancyPage } from '../coach/matchedVacancyApi';
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

const row = (index: number) => ({ cluster: { id: `v-${index}` } }) as unknown as MatchedVacancyItem;
const page = (): MatchedVacancyPage => ({
  items: Array.from({ length: 20 }, (_, index) => row(index)),
  total: 40,
  nextOffset: 20,
  pageOffsets: [0, 20],
});

async function mount(options: MatchedPoolOptions) {
  vi.mocked(getMatchedVacancyPage).mockImplementation(async () => page());
  const box: { pool?: MatchedPool } = {};
  function Reader() {
    box.pool = useMatchedPool(undefined, options);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Reader />));
  await act(async () => undefined);
  return { box, root };
}

const filtersOf = (call: number) => vi.mocked(getMatchedVacancyPage).mock.calls[call]?.[2];

describe('B768: «Вакансии по роли» читают подборку сразу с ролью', () => {
  afterEach(() => vi.clearAllMocks());

  it('начальная роль — единственный запрос строк, и он с ролью', async () => {
    const { root } = await mount({
      pageLimit: 1,
      initialFilters: { roles: ['CTO'], regions: [], remoteOnly: false },
    });
    expect(vi.mocked(getMatchedVacancyPage)).toHaveBeenCalledTimes(1);
    expect(filtersOf(0)).toMatchObject({ roles: ['CTO'] });
    await act(async () => root.unmount());
  });

  it('снятый фильтр роли читает всю подборку', async () => {
    const { box, root } = await mount({
      pageLimit: 1,
      initialFilters: { roles: ['CTO'], regions: [], remoteOnly: false },
    });
    await act(async () => box.pool!.setFilters!({ roles: [], regions: [], remoteOnly: false }));
    await act(async () => undefined);
    expect(vi.mocked(getMatchedVacancyPage)).toHaveBeenCalledTimes(2);
    expect(filtersOf(1)?.roles ?? []).toEqual([]);
    await act(async () => root.unmount());
  });

  it('без начальной роли — прежнее чтение без фильтров', async () => {
    const { root } = await mount({ pageLimit: 1 });
    expect(vi.mocked(getMatchedVacancyPage)).toHaveBeenCalledTimes(1);
    expect(filtersOf(0)).toBeUndefined();
    await act(async () => root.unmount());
  });
});
