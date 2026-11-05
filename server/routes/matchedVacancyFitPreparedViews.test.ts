import { describe, expect, it, vi } from 'vitest';

const targetReads: string[] = [];
vi.mock('./vacancyFitContext', () => ({
  createVacancyFitContextReader: () => (target: { vacancyId: string }) => ({
    vacancyId: target.vacancyId,
  }),
  readVacancyFitTarget: (_deps: unknown, id: string) => {
    targetReads.push(id);
    return { vacancyId: id };
  },
}));
vi.mock('../domain/vacancyFitProfileStamp', () => ({
  vacancyFitProfileStamp: (snapshot: { stamp: string }) => snapshot.stamp,
}));

const { withVacancyFitOrder } = await import('./matchedVacancyFit');
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { RouteDeps } from './deps';

const FIT = { by: 'fit', dir: 'desc' } as const;
const SCORED: Record<string, number> = { a: 10, b: 90, c: 50 };
const pool = ['a', 'b', 'c'].map(
  (id) =>
    ({
      cluster: { id, firstObservedAt: '2026-10-01' },
      explanation: { clusterId: id },
    }) as unknown as MatchedVacancyItem,
);

function ready(percent: number) {
  return {
    state: 'ready',
    requirements: [],
    result: {
      status: 'assessed',
      dataState: 'confirmed',
      coveragePercent: percent,
      coverage: { matched: 0, total: 12, unknown: 0 },
      requiredCoverage: { percent: null },
      assessments: [],
    },
  };
}

function deps(stamp: string): RouteDeps {
  return {
    candidateStore: { getSnapshot: () => ({ stamp }), getCandidateWorkspace: () => undefined },
    vacancyMechanics: {
      cachedVacancyIds: () => new Set(Object.keys(SCORED)),
      view: (input: { vacancyId: string }) => ready(SCORED[input.vacancyId]!),
      enqueue: vi.fn(),
    },
  } as unknown as RouteDeps;
}

const ids = (items: readonly MatchedVacancyItem[]) => items.map((entry) => entry.cluster.id);

describe('a prepared order survives a build under the same candidate\'s other profile (PRB-041, prod 05.11: 2170 ms)', () => {
  it('the build reads nothing when another stamp took the one cache entry after prepare', async () => {
    const fit = withVacancyFitOrder(deps('new'), 'overwritten', FIT);
    await fit.prepare(pool);
    await withVacancyFitOrder(deps('old'), 'overwritten', FIT).prepare(pool);
    targetReads.length = 0;

    expect(ids(fit(pool))).toEqual(['b', 'c', 'a']);
    expect(targetReads).toEqual([]);
  });

  it('a read that joined a running prepare gets the same views', async () => {
    const first = withVacancyFitOrder(deps('joined'), 'joined', FIT);
    const second = withVacancyFitOrder(deps('joined'), 'joined', FIT);
    await Promise.all([first.prepare(pool), second.prepare(pool)]);
    await withVacancyFitOrder(deps('other'), 'joined', FIT).prepare(pool);
    targetReads.length = 0;

    expect(ids(second(pool))).toEqual(['b', 'c', 'a']);
    expect(targetReads).toEqual([]);
  });

  it('an order with no prepare still reads for itself', () => {
    targetReads.length = 0;

    expect(ids(withVacancyFitOrder(deps('direct'), 'no-prepare', FIT)(pool))).toEqual(['b', 'c', 'a']);
    expect(targetReads).toEqual(['a', 'b', 'c']);
  });
});
