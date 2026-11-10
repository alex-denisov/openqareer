import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B628: каналы компаний (ярус 1) не делят шесть мест волны — у них своя
 * полоса до 96 каналов: три на хост сайта, 16 на API сервиса ATS; агрегаторы своё место сохраняют.
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
    const sites = Array.from({ length: 100 }, (_, i) => source(`site-${i}`, `c${i}.example`, 1));
    const shared = Array.from({ length: 20 }, (_, i) =>
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
    expect(companies).toHaveLength(96);
    expect(companies.filter((id) => id.startsWith('gh-'))).toHaveLength(16);
    expect(synced.filter((id) => id.startsWith('agg-'))).toHaveLength(4);
  });
});

describe('B628 — зависший канал не занимает полосу', () => {
  it('следующая волна не выбирает канал, который ещё опрашивается, и не ждёт его', async () => {
    const hung = source('hung', 'hung.example', 1);
    const others = Array.from({ length: 30 }, (_, i) => source(`s-${i}`, `s${i}.example`, 1));
    const synced: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: [hung, ...others],
      fetcher: (s) => {
        if (s.id === 'hung') return new Promise(() => undefined);
        synced.push(s.id);
        return Promise.resolve([]);
      },
      companyLaneSourceTimeoutMs: 20,
    } as ConstructorParameters<typeof MultiSourceVacancyEngine>[0]);

    const first = await engine.syncDue();
    const second = await engine.syncDue();

    expect(first.find((o) => o.sourceId === 'hung')?.status).toBe('lane_timeout');
    expect(second.some((o) => o.sourceId === 'hung')).toBe(false);
    expect(new Set(synced).size).toBe(30);
  });
});
