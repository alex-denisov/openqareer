import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { buildVacancyFilterOptions, filterByScreenState } from './vacancyScreenCriteria';
import type { VacanciesScreenState } from './vacanciesScreenState';

function item(
  id: string,
  salary?: { from?: number; to?: number; currency: string },
  marketSalary?: { low?: number; high?: number },
): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: 'Head of Engineering',
      canonicalCompany: 'Компания',
      isRemote: false,
      salary,
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.test',
      sources: [],
      firstObservedAt: '2026-10-05T00:00:00.000Z',
      lastSeenAt: '2026-10-05T00:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'exact',
      levelMatch: 'match',
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-10-05T00:00:00.000Z',
      ...(marketSalary
        ? {
            marketSalary: {
              ...marketSalary,
              currency: 'RUR',
              sampleSize: marketSalary.low ? 41 : 3,
              basis: 'city' as const,
              computedAt: '2026-10-05T00:00:00.000Z',
            },
          }
        : {}),
    },
  } as unknown as MatchedVacancyItem;
}

const items = [
  item('stated', { from: 450_000, to: 600_000, currency: 'RUR' }),
  item('estimate-high', undefined, { low: 480_000, high: 560_000 }),
  item('estimate-low', undefined, { low: 200_000, high: 300_000 }),
  item('thin', undefined, {}),
  item('none'),
];

const base: VacanciesScreenState = {
  roles: [],
  regions: [],
  remoteOnly: false,
  salaryMinimum: 450_000,
  salaryCurrency: 'RUR',
};

const ids = (state: VacanciesScreenState) =>
  filterByScreenState(items, state, '2026-10-21').map((entry) => entry.cluster.id);

describe('salary filter with the market estimate (B546)', () => {
  it('drops every vacancy without salary when both toggles are off', () => {
    expect(ids(base)).toEqual(['stated']);
  });

  it('keeps vacancies without salary when asked to show them', () => {
    expect(ids({ ...base, includeMissingSalary: true })).toEqual([
      'stated',
      'estimate-high',
      'estimate-low',
      'thin',
      'none',
    ]);
  });

  it('compares by the estimate when the estimate toggle is on', () => {
    expect(ids({ ...base, useMarketEstimate: true })).toEqual(['stated', 'estimate-high']);
    expect(ids({ ...base, useMarketEstimate: true, includeMissingSalary: true })).toEqual([
      'stated',
      'estimate-high',
      'thin',
      'none',
    ]);
  });

  it('offers the estimate currency even when no vacancy states a salary', () => {
    expect(buildVacancyFilterOptions([items[1]!]).salaryCurrencies).toEqual(['RUR']);
  });
});
