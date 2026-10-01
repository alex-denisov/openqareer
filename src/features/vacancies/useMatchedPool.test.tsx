// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatchedVacancyPage } from '../coach/coachApi';
import type { MatchedVacancyPage } from '../coach/matchedVacancyApi';
import { useMatchedPool, type MatchedPool } from './useMatchedPool';

vi.mock('../coach/coachApi', () => ({
  getMatchedVacancyPage: vi.fn(), getVacancySources: vi.fn().mockResolvedValue([]),
}));
const initial: MatchedPool = {
  matched: [], total: 9, poolTotal: 9, loading: false, failed: false, complete: true,
  facets: { total: 9, regions: [{ id: 'eu', count: 9 }], remote: 2, levels: [], roles: [], sources: [] },
};
const selected = { roles: [], regions: ['eu'], levels: [], sources: [], remoteOnly: false };
function deferred() {
  let resolve!: (page: MatchedVacancyPage) => void;
  const promise = new Promise<MatchedVacancyPage>((done) => { resolve = done; });
  return { promise, resolve };
}
const page = (total: number): MatchedVacancyPage => ({ items: [], total, nextOffset: null,
  facets: { ...initial.facets!, total: 9 } });

describe('B338 изолированное чтение фильтров', () => {
  afterEach(() => vi.clearAllMocks());

  it('перечитывает offset=0, игнорирует запоздалый ответ и сохраняет общий пул', async () => {
    const old = deferred();
    const latest = deferred();
    vi.mocked(getMatchedVacancyPage).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    let pool!: MatchedPool;
    function Reader() { pool = useMatchedPool(initial); return null; }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Reader />));
    expect(getMatchedVacancyPage).not.toHaveBeenCalled();
    await act(async () => pool.setFilters?.(selected));
    await act(async () => pool.setFilters?.({ ...selected, remoteOnly: true }));
    expect(getMatchedVacancyPage).toHaveBeenNthCalledWith(1, 0, expect.any(AbortSignal), selected);
    expect(getMatchedVacancyPage).toHaveBeenNthCalledWith(2, 0, expect.any(AbortSignal), {
      ...selected, remoteOnly: true,
    });
    await act(async () => latest.resolve(page(2)));
    expect(pool.total).toBe(2);
    await act(async () => old.resolve(page(7)));
    expect(pool.total).toBe(2);
    expect(pool.facets?.total).toBe(9);
    expect(initial.total).toBe(9);
    vi.mocked(getMatchedVacancyPage).mockResolvedValueOnce(page(9));
    await act(async () => pool.setFilters?.({ ...selected, regions: [] }));
    expect(getMatchedVacancyPage).toHaveBeenNthCalledWith(3, 0, expect.any(AbortSignal), {
      ...selected, regions: [],
    });
    expect(pool.total).toBe(9);
    await act(async () => root.unmount());
  });
});
