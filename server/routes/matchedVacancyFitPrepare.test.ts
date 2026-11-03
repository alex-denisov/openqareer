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

const { withVacancyFitOrder, withWantedCompanyOrder, STALE_REFIT_LIMIT } =
  await import('./matchedVacancyFit');
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { RouteDeps } from './deps';

const FIT = { by: 'fit', dir: 'desc' } as const;
const turns = async (count = 3) => {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setImmediate(resolve));
};

function item(id: string): MatchedVacancyItem {
  return {
    cluster: { id, firstObservedAt: '2026-10-01' },
    explanation: { clusterId: id },
  } as unknown as MatchedVacancyItem;
}

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

function deps(scored: Record<string, number>, extra: object = {}): RouteDeps {
  return {
    candidateStore: { getSnapshot: () => ({}), getCandidateWorkspace: () => undefined },
    vacancyMechanics: {
      cachedVacancyIds: () => new Set(Object.keys(scored)),
      view: (input: { vacancyId: string }) =>
        scored[input.vacancyId] === undefined
          ? { state: 'not_requested', requirements: [] }
          : ready(scored[input.vacancyId]!),
      enqueue: vi.fn(),
      ...extra,
    },
  } as unknown as RouteDeps;
}

const ids = (items: readonly MatchedVacancyItem[]) => items.map((entry) => entry.cluster.id);

describe('fit order reads percents before the page is built (PRB-041: reader.read ran inside the page build)', () => {
  it('a cold read lets queued requests run between rows', async () => {
    const order: string[] = [];
    const slowView = (input: { vacancyId: string }) => {
      const until = performance.now() + 25;
      while (performance.now() < until);
      order.push(input.vacancyId);
      return ready(50);
    };
    const fit = withVacancyFitOrder(deps({ a: 1, b: 2 }, { view: slowView }), 'prepare-turn', FIT);
    setImmediate(() => order.push('turn'));

    await fit.prepare?.([item('a'), item('b')]);

    expect(order).toEqual(['a', 'turn', 'b']);
  });

  it('after prepare the page build reads nothing and the order is the one a direct read gives', async () => {
    const pool = ['a', 'b', 'c'].map(item);
    const scored = { a: 10, b: 90, c: 50 };
    const direct = ids(withVacancyFitOrder(deps(scored), 'prepare-direct', FIT)(pool));
    const fit = withVacancyFitOrder(deps(scored), 'prepare-order', FIT);

    await fit.prepare?.(pool);
    targetReads.length = 0;

    expect(ids(fit(pool))).toEqual(direct);
    expect(direct).toEqual(['b', 'c', 'a']);
    expect(targetReads).toEqual([]);
  });

  it('a percent that landed after the snapshot is read in prepare, not in the page build', async () => {
    const pool = ['a', 'b'].map(item);
    const scored: Record<string, number> = { a: 10 };
    const fit = () => withVacancyFitOrder(deps(scored), 'prepare-landed', FIT);
    await fit().prepare?.(pool);
    scored.b = 95;
    const next = fit();

    await next.prepare?.(pool);
    targetReads.length = 0;

    expect(ids(next(pool))).toEqual(['b', 'a']);
    expect(targetReads).toEqual([]);
  });

  it('a row still counting is not read again in the page build after prepare', async () => {
    const pool = [item('a')];
    const counting = () =>
      deps(
        {},
        {
          cachedVacancyIds: () => new Set(['a']),
          view: () => ({ state: 'refreshing', requirements: [] }),
        },
      );
    await withVacancyFitOrder(counting(), 'prepare-counting', FIT).prepare?.(pool);
    const next = withVacancyFitOrder(counting(), 'prepare-counting', FIT);

    await next.prepare?.(pool);
    targetReads.length = 0;
    next(pool);

    expect(targetReads).toEqual([]);
  });

  it('two cold reads of one candidate read the rows once', async () => {
    const pool = [item('a'), item('b')];
    const scored = { a: 1, b: 2 };
    targetReads.length = 0;

    await Promise.all([
      withVacancyFitOrder(deps(scored), 'prepare-together', FIT).prepare?.(pool),
      withVacancyFitOrder(deps(scored), 'prepare-together', FIT).prepare?.(pool),
    ]);

    expect(targetReads).toEqual(['a', 'b']);
  });

  it('stale rows are queued after the page, bounded per read', async () => {
    const stale = Array.from({ length: STALE_REFIT_LIMIT + 5 }, (_, index) => 's' + index);
    const enqueue = vi.fn();
    const base = deps(
      { fresh: 80 },
      { enqueue, cachedVacancyIds: () => new Set(['fresh', ...stale]) },
    );

    withVacancyFitOrder(base, 'prepare-stale', FIT)(['fresh', ...stale].map(item));

    expect(enqueue).not.toHaveBeenCalled();
    await turns();
    expect(enqueue).toHaveBeenCalledTimes(STALE_REFIT_LIMIT);
  });

  it('a failed queue write goes to the log and does not touch the order', async () => {
    const warn = vi.fn();
    const enqueue = vi.fn(() => {
      throw new Error('busy');
    });
    const base = deps({}, { enqueue, cachedVacancyIds: () => new Set(['a']) });

    const ordered = withVacancyFitOrder(base, 'prepare-fail', FIT, { warn })([item('a')]);
    await turns();

    expect(ids(ordered)).toEqual(['a']);
    expect(warn).toHaveBeenCalledWith({ errorName: 'Error', rows: 1 }, 'fit-requeue-failed');
  });

  it('the wanted-company order passes prepare through', () => {
    const repo = { list: () => [] };
    const order = withWantedCompanyOrder(
      { ...deps({}), candidateCompanyWantsRepo: repo } as unknown as RouteDeps,
      'prepare-wanted',
      FIT,
    );
    expect(typeof order.prepare).toBe('function');
  });
});
