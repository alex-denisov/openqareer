import { describe, expect, it } from 'vitest';
import { compareMatchedVacancies, trustRank, type OrderableMatch } from './vacancyMatchOrder';

function match(cluster: OrderableMatch['cluster']): OrderableMatch {
  return { cluster, explanation: { roleMatch: 'target', levelMatch: 'match' } };
}

/** A cluster whose description reads are counted. */
function countedCluster(index: number) {
  let reads = 0;
  const cluster = {
    isRemote: true,
    primaryUrl: `https://hh.ru/vacancy/${index}`,
    firstObservedAt: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
    get descriptionSummary() {
      reads += 1;
      return 'Ищем аналитика данных';
    },
  };
  return { cluster, reads: () => reads };
}

describe('trust rank per vacancy record (PRB-041: trust text checks ran in every sort comparison)', () => {
  it('checks the text of each record once however many comparisons a sort makes', () => {
    const counted = Array.from({ length: 60 }, (_, index) => countedCluster(index));
    const matches = counted.map(({ cluster }) => match(cluster));
    const now = '2026-11-03T12:00:00.000Z';

    [...matches].sort((left, right) => compareMatchedVacancies(left, right, now));
    [...matches].reverse().sort((left, right) => compareMatchedVacancies(left, right, now));

    expect(counted.map(({ reads }) => reads())).toEqual(counted.map(() => 1));
  });

  it('still ages the same record against the time it is ranked at', () => {
    const cluster = { firstObservedAt: '2026-08-01T00:00:00.000Z' };

    expect(trustRank(match(cluster), '2026-08-10T00:00:00.000Z')).toBe(2);
    expect(trustRank(match(cluster), '2026-11-01T00:00:00.000Z')).toBe(1);
  });

  it('ranks a new version of a record afresh', () => {
    const first = { descriptionSummary: 'Ищем аналитика данных' };
    const updated = { descriptionSummary: 'Нужен вступительный взнос' };

    expect(trustRank(match(first))).toBe(2);
    expect(trustRank(match(updated))).toBe(0);
  });
});
