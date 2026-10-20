import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';

describe('catalog listings cache (B535)', () => {
  it('reads the listing counts once per window instead of on every page', () => {
    const pool = new MemoryVacancyPoolStore();
    let reads = 0;
    const original = pool.loadCatalogListings?.bind(pool);
    if (!original) return;
    pool.loadCatalogListings = () => {
      reads += 1;
      return original();
    };
    const engine = new MultiSourceVacancyEngine({ sources: [], pool });
    engine.getPublicCatalogListings();
    engine.getPublicCatalogListings();
    engine.getPublicCatalogListings();
    expect(reads).toBeLessThanOrEqual(1);
  });
});
