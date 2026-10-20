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
vi.mock('../domain/vacancyFitProfileStamp', () => ({ vacancyFitProfileStamp: () => 'stamp' }));

const { withVacancyFitOrder, withShownPageFitViews } = await import('./matchedVacancyFit');
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { RouteDeps } from './deps';

function item(id: string): MatchedVacancyItem {
  return {
    cluster: { id, firstObservedAt: '2026-10-01' },
    explanation: { clusterId: id },
  } as unknown as MatchedVacancyItem;
}

function deps(scored: Record<string, number>): RouteDeps {
  return {
    candidateStore: { getSnapshot: () => ({}), getCandidateWorkspace: () => undefined },
    vacancyMechanics: {
      cachedVacancyIds: () => new Set(Object.keys(scored)),
      view: (input: { vacancyId: string }) =>
        input.vacancyId in scored
          ? {
              state: 'ready',
              requirements: [],
              result: {
                status: 'assessed',
                coveragePercent: scored[input.vacancyId],
                requiredCoverage: { percent: null },
                assessments: [],
              },
            }
          : { state: 'not_requested', requirements: [] },
    },
  } as unknown as RouteDeps;
}

describe('pool fit order', () => {
  it('reads full fit evidence only for vacancies that have a stored result', () => {
    targetReads.length = 0;
    const pool = Array.from({ length: 500 }, (_, index) => item('v' + index));
    const ordered = withVacancyFitOrder(deps({ v400: 90, v7: 40 }), 'order-a', 'fit')(pool);
    expect(ordered.slice(0, 2).map((entry) => entry.cluster.id)).toEqual(['v400', 'v7']);
    expect(targetReads.sort()).toEqual(['v400', 'v7']);
  });

  it('gives every vacancy of the shown page its current fit state', () => {
    const page = withShownPageFitViews(deps({ b: 70 }), 'order-b', [item('a'), item('b')]);
    expect(page.map((entry) => entry.explanation.fitView?.state)).toEqual([
      'not_requested',
      'ready',
    ]);
  });
});
