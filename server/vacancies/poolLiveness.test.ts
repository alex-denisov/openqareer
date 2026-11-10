import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import {
  confirmsLiveness,
  freshnessAnchorMs,
  NOT_SEEN_PRUNE_DAYS,
  sourceKind,
} from './poolLiveness';

const DAY = 24 * 60 * 60 * 1000;

function source(id: string, type: VacancySourceConfig['type'] = 'json_api'): VacancySourceConfig {
  return {
    id,
    name: id,
    type,
    enabled: true,
    targetUrl: `https://example.test/${id}`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

function vacancy(id: string, sourceId: string, ageDays: number): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `Chief Data Officer ${id}`,
    company: 'Acme',
    isRemote: true,
    description: 'A long-running executive search.',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: `https://example.test/${id}`,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date(Date.now() - ageDays * DAY).toISOString(),
    status: 'active',
  };
}

describe('какие источники подтверждают, что вакансия открыта (B642)', () => {
  it('доски ATS и карьерные сайты работодателей — да, агрегаторы — нет', () => {
    expect(confirmsLiveness('ats-greenhouse-stripe')).toBe(true);
    expect(confirmsLiveness('src-amazon-jobs')).toBe(true);
    expect(confirmsLiveness('src-hh-search')).toBe(false);
    expect(confirmsLiveness('src-himalayas-api')).toBe(false);
    expect(confirmsLiveness('src-linkedin-guest')).toBe(false);
    expect(confirmsLiveness('src-indeed')).toBe(false);
  });

  it('окно свежести у живой вакансии работодателя меряет дату последнего чтения', () => {
    const old = vacancy('a', 'ats-greenhouse-stripe', 90);
    expect(freshnessAnchorMs(old)).toBe(Date.parse(old.provenance.observedAt));
    const agg = vacancy('b', 'src-himalayas-api', 90);
    expect(freshnessAnchorMs(agg)).toBe(Date.parse(agg.publishedAt));
  });

  it('невиденную неделю запись уборка снимает', () => {
    expect(NOT_SEEN_PRUNE_DAYS).toBe(7);
  });
});

describe('приём улова (B642)', () => {
  async function kept(sourceId: string): Promise<string[]> {
    const engine = new MultiSourceVacancyEngine({
      sources: [source(sourceId)],
      fetcher: async () => [
        vacancy(`${sourceId}-old`, sourceId, 90),
        vacancy(`${sourceId}-new`, sourceId, 3),
      ],
    });
    await engine.syncAll();
    return engine.getVacancies().items.map((v) => v.id);
  }

  it('приём старых живых откатан (B642, 1,5×): полное чтение ATS держит 30 дней', async () => {
    const ids = await kept('ats-greenhouse-acme');
    expect(ids).not.toContain('ats-greenhouse-acme-old');
    expect(ids).toContain('ats-greenhouse-acme-new');
  });

  it('агрегатор по-прежнему держит только 30 дней от публикации', async () => {
    const ids = await kept('src-himalayas-api');
    expect(ids).not.toContain('src-himalayas-api-old');
    expect(ids).toContain('src-himalayas-api-new');
  });
});

describe('тип настоящего источника, а не репозитория адаптера (B642)', () => {
  it('доски ATS и сайты компаний из freehire — работодательские, площадки — агрегаторы', () => {
    expect(sourceKind('src-fh-icims-careers-acme')).toEqual({ kind: 'ats', provider: 'icims' });
    expect(sourceKind('src-fh-oracle-eeho')).toEqual({ kind: 'ats', provider: 'oracle' });
    expect(sourceKind('ats-greenhouse-stripe')).toEqual({ kind: 'ats', provider: 'greenhouse' });
    expect(sourceKind('src-fh-sber')).toEqual({ kind: 'employer_site' });
    expect(sourceKind('src-amazon-jobs')).toEqual({ kind: 'employer_site' });
    expect(sourceKind('src-fh-habr-career')).toEqual({ kind: 'aggregator' });
    expect(sourceKind('src-fh-getmatch')).toEqual({ kind: 'aggregator' });
    expect(sourceKind('src-hh-search')).toEqual({ kind: 'hh' });
    expect(sourceKind('src-linkedin-guest')).toEqual({ kind: 'linkedin' });
    expect(sourceKind('src-himalayas-api')).toEqual({ kind: 'aggregator' });
    expect(confirmsLiveness('src-fh-icims-careers-acme')).toBe(true);
    expect(confirmsLiveness('src-fh-sber')).toBe(true);
    expect(confirmsLiveness('src-fh-habr-career')).toBe(false);
    expect(sourceKind('src-company-li-123')).toEqual({ kind: 'linkedin' });
    expect(sourceKind('src-company-site-acme')).toEqual({ kind: 'employer_site' });
  });
});
