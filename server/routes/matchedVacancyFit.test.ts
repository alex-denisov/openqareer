import { describe, expect, it } from 'vitest';
import { compareFitOrder } from './matchedVacancyFit';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyFitResult } from '../../shared/vacancyFit';

function item(id: string, score: number | null, observed = '2026-10-01'): MatchedVacancyItem {
  const result = { status: 'assessed', coveragePercent: score,
    requiredCoverage: { percent: null } } as VacancyFitResult;
  return {
    cluster: { id, canonicalTitle: 'Engineer', canonicalCompany: '', canonicalLocation: '',
      isRemote: true, descriptionSummary: '', skills: [], primaryUrl: 'https://example.test/' + id, sources: [],
      firstObservedAt: observed, lastSeenAt: observed, status: 'active', vacanciesCount: 1 },
    explanation: { clusterId: id, roleMatch: 'target', levelMatch: 'match', matchingPoints: [],
      missingPoints: [], summary: '', calculatedAt: observed,
      fitView: { state: 'ready', requirements: [], result } },
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
