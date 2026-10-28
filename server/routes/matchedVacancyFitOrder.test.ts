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

const { withVacancyFitOrder, withShownPageFitViews, withWantedCompanyOrder, STALE_REFIT_LIMIT } =
  await import('./matchedVacancyFit');
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { RouteDeps } from './deps';
import { candidateCompanyKey } from '../domain/candidateCompanies';

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
                dataState: 'confirmed',
                coveragePercent: scored[input.vacancyId],
                coverage: { matched: 0, total: 12, unknown: 0 },
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

  it('serves the previous order past the window and refreshes it in the background (PRB-040)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const scored: Record<string, number> = { a: 10, b: 90 };
      const pool = [item('a'), item('b')];
      const ids = () =>
        withVacancyFitOrder(deps(scored), 'order-swr', 'fit')(pool).map((e) => e.cluster.id);
      expect(ids()).toEqual(['b', 'a']);
      scored.a = 95;
      expect(ids()).toEqual(['b', 'a']);
      vi.advanceTimersByTime(61_000);
      targetReads.length = 0;
      expect(ids()).toEqual(['b', 'a']);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(targetReads.sort()).toEqual(['a', 'b']);
      expect(ids()).toEqual(['a', 'b']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('B562: a stored result under an older profile key is computed again', () => {
  it('queues vacancies that had a result but have none for the current profile, bounded per read', () => {
    const enqueue = vi.fn();
    const stale = Array.from({ length: STALE_REFIT_LIMIT + 5 }, (_, index) => 's' + index);
    const base = deps({ fresh: 80 });
    const runtime = {
      ...(base.vacancyMechanics as object),
      cachedVacancyIds: () => new Set(['fresh', ...stale]),
      enqueue,
    };
    withVacancyFitOrder(
      { ...base, vacancyMechanics: runtime } as unknown as RouteDeps,
      'order-stale',
      'fit',
    )(['fresh', ...stale].map(item));
    expect(enqueue).toHaveBeenCalledTimes(STALE_REFIT_LIMIT);
    expect(enqueue.mock.calls.map(([input]) => input.vacancyId)).not.toContain('fresh');
  });
});

describe('B422: компании «Хочу» в порядке подборки', () => {
  const withCompany = (id: string, company: string) =>
    ({
      ...item(id),
      cluster: { ...item(id).cluster, canonicalCompany: company },
    }) as MatchedVacancyItem;
  const wantDeps = (scored: Record<string, number>) =>
    ({
      ...deps(scored),
      candidateCompanyWantsRepo: { list: () => [{ companyKey: candidateCompanyKey('Acme') }] },
    }) as unknown as RouteDeps;

  it('«по соответствию»: вакансии отмеченной компании выше, внутри — порядок разбора', () => {
    const pool = [withCompany('a', 'Other'), withCompany('b', 'Acme'), withCompany('c', 'Acme')];
    const ordered = withWantedCompanyOrder(wantDeps({ a: 90, c: 50 }), 'want-a', 'fit')(pool);
    expect(ordered.map((entry) => entry.cluster.id)).toEqual(['c', 'b', 'a']);
  });

  it('ключ кэша списка меняется вместе с отметками «Хочу»', () => {
    const none = withWantedCompanyOrder(deps({}), 'want-c', 'fit').cacheKey;
    const marked = withWantedCompanyOrder(wantDeps({}), 'want-c', 'fit').cacheKey;
    expect(none).toBe('');
    expect(marked).toBe(candidateCompanyKey('Acme'));
  });

  it('«по свежести» отметку не учитывает', () => {
    const pool = [withCompany('a', 'Other'), withCompany('b', 'Acme')];
    const ordered = withWantedCompanyOrder(wantDeps({}), 'want-b', 'freshness')(pool);
    expect(ordered[0]?.cluster.id).toBe('a');
  });
});
