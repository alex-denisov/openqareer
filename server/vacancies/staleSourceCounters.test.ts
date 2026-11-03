import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';

/**
 * 2026-11-03: the admin showed 41 271 LinkedIn records while the pool held none.
 * The counter was the number persisted by the last successful sync (2026-09-21)
 * and was restored verbatim after the rows had expired.
 */
describe('restored source counters', () => {
  function engineWithState(lastStatus: 'healthy' | 'error', pooledRows: number) {
    const source = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-linkedin-guest')!;
    const pool = new MemoryVacancyPoolStore();
    pool.saveSourceState({
      sourceId: source.id,
      lastSyncAt: '2026-09-21T21:58:19.537Z',
      lastStatus,
      itemsFoundTotal: 41_271,
      itemsActiveTotal: 41_271,
    });
    const original = pool.countSourceSlice.bind(pool);
    pool.countSourceSlice = (id: string) =>
      id === source.id ? { total: pooledRows, active: pooledRows } : original(id);
    const engine = new MultiSourceVacancyEngine({ sources: [{ ...source }], pool });
    return engine.getSources().find((s) => s.id === source.id)!;
  }

  it('failing source: counters come from the live slice, not the stale snapshot', () => {
    const restored = engineWithState('error', 0);
    expect(restored.itemsFoundTotal).toBe(0);
    expect(restored.itemsActiveTotal).toBe(0);
  });

  it('healthy source keeps the persisted snapshot (no extra reads at start)', () => {
    const restored = engineWithState('healthy', 0);
    expect(restored.itemsActiveTotal).toBe(41_271);
  });
});
