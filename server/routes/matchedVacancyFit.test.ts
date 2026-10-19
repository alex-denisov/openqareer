import { describe, expect, it } from 'vitest';
import { compactFitView, compareFitOrder, vacanciesAwaitingFit } from './matchedVacancyFit';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyFitResult } from '../../shared/vacancyFit';

function item(id: string, score: number | null, observed = '2026-10-01'): MatchedVacancyItem {
  const result = {
    status: 'assessed',
    coveragePercent: score,
    requiredCoverage: { percent: null },
  } as VacancyFitResult;
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
  it('switches the entire order to freshness', () => {
    const all = [item('fit', 90, '2026-09-01'), item('fresh', null, '2026-10-01')];
    expect(all.sort((a, b) => compareFitOrder(a, b, 'freshness'))[0]?.cluster.id).toBe('fresh');
  });
});

describe('B524 background fit for the shown page', () => {
  function withState(
    id: string,
    state: 'not_requested' | 'processing' | 'ready' | 'no_description',
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
});

describe('B525 list carries a fit summary, not the full evidence', () => {
  it('drops requirement texts and assessment quotes but keeps what the row and sort read', () => {
    const view = {
      state: 'ready' as const,
      requirements: [{ id: 'r1', text: 'x'.repeat(2000) }],
      result: { status: 'assessed', coveragePercent: 14, requiredCoverage: { percent: 0 },
        assessments: [{ requirementId: 'r1', status: 'matched', evidence: [{ factId: 'f', quote: 'y'.repeat(2000) }] }] },
    } as never;
    const compact = compactFitView(view);
    expect(compact.requirements).toEqual([]);
    expect(compact.result?.assessments).toEqual([]);
    expect(compact.result?.coveragePercent).toBe(14);
    expect(JSON.stringify(compact).length).toBeLessThan(400);
  });
});
