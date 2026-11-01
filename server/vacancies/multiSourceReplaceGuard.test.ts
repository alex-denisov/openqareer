import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

// 27.10: one Indeed reading of 534 records replaced a slice of 170 K. A
// replace that would wipe most of a large slice is refused and merged.
function vacancies(count: number, offset = 0): UnifiedVacancy[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, index) => {
    const id = `guard-${offset + index}`;
    return {
      id,
      fingerprint: `fp-${id}`,
      title: `Engineer ${offset + index}`,
      company: `Company ${offset + index}`,
      description: 'A role',
      requiredSkills: [],
      url: `https://guard.test/${id}`,
      provenance: {
        sourceType: 'direct' as const,
        sourceId: 'guard-source',
        sourceUrl: `https://guard.test/${id}`,
        externalId: id,
        observedAt: now,
      },
      publishedAt: now,
      status: 'active' as const,
    };
  });
}

function engineReading(readings: UnifiedVacancy[][]): MultiSourceVacancyEngine {
  let round = 0;
  return new MultiSourceVacancyEngine({
    sources: [
      {
        id: 'guard-source',
        name: 'Guard',
        type: 'direct',
        enabled: true,
        targetUrl: 'https://guard.test',
        refreshIntervalMinutes: 1,
        itemsFoundTotal: 0,
        itemsActiveTotal: 0,
      },
    ],
    recluster: { mode: 'sync' },
    fetcher: async () => readings[round++] ?? [],
  });
}

describe('replace guard for a source slice', () => {
  it('refuses a full reading that would remove most of a large slice and merges it instead', async () => {
    const engine = engineReading([vacancies(400), vacancies(10, 1_000)]);
    await engine.syncSource('guard-source');
    const outcome = await engine.syncSource('guard-source');

    expect(outcome.status).toBe('healthy');
    expect(outcome.replaceRefused).toEqual({ existing: 400, fetched: 10 });
    expect(engine.getSources().find((s) => s.id === 'guard-source')?.itemsFoundTotal).toBe(410);
  });

  it('still replaces when the reading keeps most of the slice', async () => {
    const engine = engineReading([vacancies(400), vacancies(300)]);
    await engine.syncSource('guard-source');
    const outcome = await engine.syncSource('guard-source');

    expect(outcome.replaceRefused).toBeUndefined();
    expect(engine.getSources().find((s) => s.id === 'guard-source')?.itemsFoundTotal).toBe(300);
  });
});
