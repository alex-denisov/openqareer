import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';

/** 2026-11-03: disabled Glassdoor kept showing "spawn obscura ENOENT". */
describe('disabled source restored from stored state', () => {
  it('drops the stale error and keeps the disabled reason', () => {
    const source = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-glassdoor')!;
    const pool = new MemoryVacancyPoolStore();
    pool.saveSourceState({
      sourceId: source.id,
      lastStatus: 'error',
      lastErrorMessage: 'spawn obscura ENOENT',
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    });
    const engine = new MultiSourceVacancyEngine({ sources: [{ ...source }], pool });
    const restored = engine.getSources().find((s) => s.id === source.id)!;
    expect(restored.lastErrorMessage).toBeUndefined();
    expect((restored as { disabledReason?: string }).disabledReason).toContain('Indeed');
  });
});
