import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../multiSourceVacancyEngine';
import { attachMarketSalaryEstimates } from './attachMarketSalaryEstimates';

function item(title: string, salary?: { from: number; currency: string }) {
  return {
    cluster: { id: `cluster-${title}`, canonicalTitle: title, salary },
    explanation: { clusterId: `cluster-${title}` },
  } as unknown as MatchedVacancyItem;
}

describe('attachMarketSalaryEstimates', () => {
  it('adds the estimate to a vacancy without salary and leaves the stated one', () => {
    const view = {
      low: 1,
      high: 2,
      currency: 'USD',
      period: 'month',
      tax: 'unknown',
      computedAt: '2026-11-25T00:00:00.000Z',
    } as const;
    const deps = {
      store: {
        estimate: ({ canonicalTitle }: { canonicalTitle: string }) =>
          canonicalTitle === 'CTO' ? view : undefined,
      },
      readTitle: () => undefined,
    };
    const [added, unknown, stated] = attachMarketSalaryEstimates(
      [item('CTO'), item('Other'), item('CTO', { from: 1, currency: 'RUR' })],
      deps,
    );
    expect(added?.explanation.marketSalary).toEqual(view);
    expect(unknown?.explanation.marketSalary).toBeUndefined();
    expect(stated?.explanation.marketSalary).toBeUndefined();
  });
});
