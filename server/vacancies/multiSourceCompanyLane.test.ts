import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B628: каналы компаний (ярус 1) не делят шесть мест волны — у них своя
 * полоса до 24 каналов с лимитом три на хост; агрегаторы своё место сохраняют.
 */
function source(id: string, host: string, tier: 1 | 3): VacancySourceConfig {
  return {
    id,
    name: id,
    type: 'career_site',
    enabled: true,
    targetUrl: `https://${host}/jobs`,
    refreshIntervalMinutes: 720,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
    channelTier: tier,
  };
}

describe('B628 — полоса каналов компаний', () => {
  it('одна волна опрашивает больше шести сайтов компаний и не забывает агрегаторы', async () => {
    const sites = Array.from({ length: 30 }, (_, i) => source(`site-${i}`, `c${i}.example`, 1));
    const shared = Array.from({ length: 5 }, (_, i) =>
      source(`gh-${i}`, 'boards-api.greenhouse.io', 1),
    );
    const aggregators = Array.from({ length: 4 }, (_, i) =>
      source(`agg-${i}`, `agg${i}.example`, 3),
    );
    const synced: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: [...shared, ...sites, ...aggregators],
      fetcher: async (s) => {
        synced.push(s.id);
        return [];
      },
    });

    await engine.syncDue();

    const companies = synced.filter((id) => !id.startsWith('agg-'));
    expect(companies).toHaveLength(24);
    expect(companies.filter((id) => id.startsWith('gh-'))).toHaveLength(3);
    expect(synced.filter((id) => id.startsWith('agg-'))).toHaveLength(4);
  });
});
