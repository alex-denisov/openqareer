import { describe, expect, it } from 'vitest';
import { attachMarketSalaryEstimates } from './attachMarketSalaryEstimates';
import type { MatchedVacancyItem } from '../multiSourceVacancyEngine';

function item(title: string, location: string, salary?: { from: number; currency: string }) {
  return {
    cluster: { id: `cluster-${title}`, canonicalTitle: title, canonicalLocation: location, salary },
    explanation: { clusterId: `cluster-${title}` },
  } as unknown as MatchedVacancyItem;
}

const computedAt = '2026-10-05T03:00:00.000Z';
const estimates = new Map([
  [
    'it-eng-mgmt|4|city|москва',
    { low: 480_000, high: 560_000, currency: 'RUR', sampleSize: 41, computedAt },
  ],
  ['it-eng-mgmt|4|city|казань', { currency: 'RUR', sampleSize: 2, computedAt }],
  ['it-eng-mgmt|4|region|ru', { currency: 'RUR', sampleSize: 3, computedAt }],
]);
const deps = {
  store: { get: (key: string) => estimates.get(key) },
  readTitle: () => ({ functions: ['it-eng-mgmt'], levelRank: 4 }),
};

describe('attachMarketSalaryEstimates', () => {
  it('attaches the city estimate to a vacancy without salary', () => {
    const [result] = attachMarketSalaryEstimates([item('Head of Platform', 'Москва')], deps);
    expect(result?.explanation.marketSalary).toEqual({
      low: 480_000,
      high: 560_000,
      currency: 'RUR',
      sampleSize: 41,
      basis: 'city',
      computedAt,
    });
  });

  it('keeps a thin sample without a number and leaves salaried vacancies alone', () => {
    const [thin, salaried] = attachMarketSalaryEstimates(
      [item('Head of Platform', 'Казань'), item('CTO', 'Москва', { from: 1, currency: 'RUR' })],
      deps,
    );
    expect(thin?.explanation.marketSalary).toEqual({
      currency: 'RUR',
      sampleSize: 3,
      basis: 'region',
      computedAt,
    });
    expect(salaried?.explanation.marketSalary).toBeUndefined();
  });

  it('gives nothing when the title has no parsed function', () => {
    const [result] = attachMarketSalaryEstimates([item('Head of Platform', 'Москва')], {
      ...deps,
      readTitle: () => undefined,
    });
    expect(result?.explanation.marketSalary).toBeUndefined();
  });
});
