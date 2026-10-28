import { describe, expect, it } from 'vitest';
import {
  compactFitView,
  compareFitOrder,
  explanationWithFitView,
  vacanciesAwaitingFit,
  vacanciesToWarm,
} from './matchedVacancyFit';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyFitResult } from '../../shared/vacancyFit';

function item(id: string, score: number | null, observed = '2026-10-01'): MatchedVacancyItem {
  const result = {
    status: 'assessed',
    dataState: 'confirmed',
    coveragePercent: score,
    coverage: { matched: 0, total: 12, unknown: 0 },
    requiredCoverage: { percent: null },
  } as unknown as VacancyFitResult;
  return {
    cluster: {
      id,
      canonicalTitle: 'Engineer',
      canonicalCompany: '',
      canonicalLocation: '',
      isRemote: true,
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.test/' + id,
      sources: [],
      firstObservedAt: observed,
      lastSeenAt: observed,
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target',
      levelMatch: 'match',
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: observed,
      fitView: { state: 'ready', requirements: [], result },
    },
  };
}
describe('B525 whole-pool order before page slicing', () => {
  it('puts measured coverage before unknown and preserves a real zero', () => {
    const all = [item('unknown', null), item('zero', 0), item('high', 85)];
    expect(all.sort(compareFitOrder).map((x) => x.cluster.id)).toEqual(['high', 'zero', 'unknown']);
  });
  it('moves a later-page result into the first transport page', () => {
    const all = Array.from({ length: 150 }, (_, i) => item(String(i), i === 149 ? 90 : null));
    const page = buildMatchedVacancyPage(all.sort(compareFitOrder), 0);
    expect(page.items[0]?.cluster.id).toBe('149');
    expect(page.nextOffset).not.toBeNull();
  });
  it('orders by the shown percent, not by mandatory coverage first (28.10 mockup)', () => {
    const withRequired = (id: string, score: number, required: number) => {
      const base = item(id, score);
      const fitView = base.explanation.fitView!;
      return {
        ...base,
        explanation: {
          ...base.explanation,
          fitView: {
            ...fitView,
            result: {
              ...fitView.result!,
              requiredCoverage: { matched: 0, total: 1, percent: required },
            },
          },
        },
      } as MatchedVacancyItem;
    };
    const all = [withRequired('a', 55, 100), withRequired('b', 92, 0)];
    expect(all.sort(compareFitOrder).map((x) => x.cluster.id)).toEqual(['b', 'a']);
  });
  it('puts a percent from fewer than 3 requirements after counted rows', () => {
    const few = item('few', 100);
    const fitView = few.explanation.fitView!;
    const fewRow = {
      ...few,
      explanation: {
        ...few.explanation,
        fitView: {
          ...fitView,
          result: { ...fitView.result!, coverage: { matched: 1, total: 1, unknown: 0 } },
        },
      },
    } as MatchedVacancyItem;
    expect([fewRow, item('low', 12)].sort(compareFitOrder).map((x) => x.cluster.id)).toEqual([
      'low',
      'few',
    ]);
  });
  it('switches the entire order to freshness', () => {
    const all = [item('fit', 90, '2026-09-01'), item('fresh', null, '2026-10-01')];
    expect(all.sort((a, b) => compareFitOrder(a, b, 'freshness'))[0]?.cluster.id).toBe('fresh');
  });
});

describe('B524 background fit for the shown page', () => {
  function withState(
    id: string,
    state: 'not_requested' | 'processing' | 'refreshing' | 'ready' | 'no_description' | 'failed',
  ) {
    const base = item(id, null);
    return {
      ...base,
      explanation: { ...base.explanation, fitView: { state, requirements: [] } },
    } as MatchedVacancyItem;
  }
  it('queues only vacancies nobody asked to compute yet, at most one page', () => {
    const page = [
      withState('new', 'not_requested'),
      withState('busy', 'processing'),
      withState('done', 'ready'),
      withState('empty', 'no_description'),
      ...Array.from({ length: 30 }, (_, i) => withState('n' + i, 'not_requested')),
    ];
    const ids = vacanciesAwaitingFit(page);
    expect(ids[0]).toBe('new');
    expect(ids).not.toContain('busy');
    expect(ids).not.toContain('done');
    expect(ids).not.toContain('empty');
    expect(ids).toHaveLength(20);
  });
  it('queues a vacancy that shows a percent of the previous algorithm version (B562-r)', () => {
    expect(
      vacanciesAwaitingFit([withState('old', 'refreshing'), withState('done', 'ready')]),
    ).toEqual(['old']);
  });
  it('warms the top rows and the best uncounted rows below them (28.10, QA_CANDIDATE)', () => {
    const counted = Array.from({ length: 25 }, (_, i) => item('c' + i, 60));
    const unscored = (id: string) => {
      const base = item(id, null);
      return {
        ...base,
        explanation: { ...base.explanation, fitView: undefined },
      } as MatchedVacancyItem;
    };
    const tail = [
      withState('hh-empty', 'no_description'),
      unscored('never-seen'),
      withState('busy', 'processing'),
      ...Array.from({ length: 30 }, (_, i) => unscored('t' + i)),
    ];
    const ids = vacanciesToWarm([...counted, ...tail], 20);
    expect(ids.slice(0, 20)).toEqual(counted.slice(0, 20).map((entry) => entry.cluster.id));
    expect(ids).toContain('hh-empty');
    expect(ids).toContain('never-seen');
    expect(ids).not.toContain('busy');
    expect(ids).not.toContain('c22');
    expect(ids).toHaveLength(40);
  });
  it('retries a calculation that failed on a provider outage', () => {
    expect(vacanciesAwaitingFit([withState('down', 'failed'), withState('done', 'ready')])).toEqual(
      ['down'],
    );
  });
});

describe('B525 list carries a fit summary, not the full evidence', () => {
  it('drops requirement texts and assessment quotes but keeps what the row and sort read', () => {
    const view = {
      state: 'ready' as const,
      requirements: [{ id: 'r1', text: 'x'.repeat(2000) }],
      result: {
        status: 'assessed',
        coveragePercent: 14,
        requiredCoverage: { percent: 0 },
        assessments: [
          {
            requirementId: 'r1',
            status: 'matched',
            evidence: [{ factId: 'f', quote: 'y'.repeat(2000) }],
          },
        ],
      },
    } as never;
    const compact = compactFitView(view);
    expect(compact.requirements).toEqual([]);
    expect(compact.result?.assessments).toEqual([]);
    expect(compact.result?.coveragePercent).toBe(14);
    expect(JSON.stringify(compact).length).toBeLessThan(400);
  });
});

describe('строка и разбор считают требования одинаково (B525)', () => {
  it('сводка и счёт строки берутся из того же разбора, что и раскрытая карточка', () => {
    const base = item('v1', null);
    const fitView = {
      state: 'ready',
      requirements: [],
      result: { status: 'unknown', coverage: { matched: 0, total: 10, unknown: 10 } },
    } as unknown as NonNullable<MatchedVacancyItem['explanation']['fitView']>;
    const stale = {
      ...base.explanation,
      requirements: { matched: 2, total: 3 },
      summary: 'Совпало 2 из 3 требований вакансии. Название совпадает с целевой ролью.',
    };
    const explanation = explanationWithFitView(stale, fitView);
    expect(explanation.requirements).toEqual({ matched: 0, total: 10 });
    expect(explanation.summary).toBe(
      'Совпало 0 из 10 требований вакансии. Название совпадает с целевой ролью.',
    );
    expect(explanation.fitView).toBe(fitView);
  });

  it('без разбора оставляет счёт правил', () => {
    const base = item('v2', null);
    const fitView = { state: 'queued', requirements: [] } as unknown as NonNullable<
      MatchedVacancyItem['explanation']['fitView']
    >;
    const explanation = explanationWithFitView(
      { ...base.explanation, requirements: { matched: 1, total: 2 } },
      fitView,
    );
    expect(explanation.requirements).toEqual({ matched: 1, total: 2 });
  });
});
