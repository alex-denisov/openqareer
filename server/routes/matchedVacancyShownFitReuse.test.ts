import { describe, expect, it, vi } from 'vitest';

const targetReads: string[] = [];
vi.mock('./vacancyFitContext', () => ({
  createVacancyFitContextReader: () => (target: { vacancyId: string }) => ({
    vacancyId: target.vacancyId,
  }),
  readVacancyFitTarget: (_deps: unknown, id: string) => {
    targetReads.push(id);
    return { vacancyId: id, description: 'Текст вакансии', fullText: true };
  },
}));
vi.mock('../domain/vacancyFitProfileStamp', () => ({
  vacancyFitProfileStamp: (snapshot: { stamp: string }) => snapshot.stamp,
}));

const { withShownPageFitViews, withVacancyFitOrder } = await import('./matchedVacancyFit');
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { RouteDeps } from './deps';

const FIT = { by: 'fit', dir: 'desc' } as const;

function row(id: string): MatchedVacancyItem {
  return {
    cluster: { id, firstObservedAt: '2026-10-01' },
    explanation: { clusterId: id, matchingPoints: [], missingPoints: [] },
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
      coverage: { matched: 3, total: 4, unknown: 0 },
      requiredCoverage: { percent: null },
      assessments: [],
    },
  };
}

/** `a`, `b` посчитаны; `q` ещё в очереди — его состояние меняется без смены профиля. */
function deps(stamp: string, views: Record<string, unknown>): RouteDeps {
  return {
    candidateStore: { getSnapshot: () => ({ stamp }), getCandidateWorkspace: () => undefined },
    vacancyMechanics: {
      cachedVacancyIds: () => new Set(Object.keys(views)),
      view: (input: { vacancyId: string }) => views[input.vacancyId],
      enqueue: vi.fn(),
    },
  } as unknown as RouteDeps;
}

const queued = { state: 'processing', requirements: [] };

describe('B725: показанная страница берёт готовый разбор, прочитанный порядком', () => {
  it('готовые строки не читаются второй раз; строка в очереди читается живой', async () => {
    const pool = ['a', 'b', 'q'].map(row);
    const views = { a: ready(80), b: ready(40), q: queued };
    await withVacancyFitOrder(deps('p1', views), 'reuse', FIT).prepare(pool);
    targetReads.length = 0;

    const shown = await withShownPageFitViews(deps('p1', views), 'reuse', pool, true);

    expect(targetReads).toEqual(['q']);
    expect(shown.map((item) => item.explanation.fitView?.result?.coveragePercent)).toEqual([
      80,
      40,
      undefined,
    ]);
    expect(shown[0]!.explanation.requirements).toEqual({ matched: 3, total: 4 });
    expect(shown[2]!.explanation.fitView?.state).toBe('processing');
  });

  it('после правки профиля готовый разбор прежнего профиля не берётся', async () => {
    const pool = ['a', 'b'].map(row);
    const before = { a: ready(80), b: ready(40) };
    await withVacancyFitOrder(deps('p1', before), 'edited', FIT).prepare(pool);
    targetReads.length = 0;

    const after = { a: ready(20), b: ready(10) };
    const shown = await withShownPageFitViews(deps('p2', after), 'edited', pool, true);

    expect(targetReads).toEqual(['a', 'b']);
    expect(shown.map((item) => item.explanation.fitView?.result?.coveragePercent)).toEqual([
      20, 10,
    ]);
  });

  it('без прочитанного порядка страница читает все строки сама', async () => {
    const pool = ['a', 'b'].map(row);
    targetReads.length = 0;
    await withShownPageFitViews(deps('p1', { a: ready(80), b: ready(40) }), 'cold', pool, true);
    expect(targetReads).toEqual(['a', 'b']);
  });
});
