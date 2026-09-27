import { describe, expect, it } from 'vitest';
import { countMatchedVacanciesByRole } from './vacancyRoleCounts';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

function item(id: string, title: string): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: title,
      canonicalCompany: 'Acme',
      isRemote: true,
      skills: [],
      primaryUrl: `https://example.com/${id}`,
      sources: [],
      firstObservedAt: '2026-08-18T00:00:00.000Z',
      lastSeenAt: '2026-08-18T00:00:00.000Z',
      descriptionSummary: '',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target',
      levelMatch: 'unknown',
      matchingPoints: [],
      missingPoints: [],
      summary: 'summary',
      calculatedAt: '2026-08-18T00:00:00.000Z',
    },
  };
}

describe('countMatchedVacanciesByRole (B248)', () => {
  it('counts vacancies whose title matches a campaign role', () => {
    const matched = [
      item('a', 'VP Technology Ops'),
      item('b', 'Business Information Architect'),
      item('c', 'VP Technology Ops, EMEA'),
    ];
    const counts = countMatchedVacanciesByRole(matched, ['VP Technology Ops', 'COO']);
    expect(counts).toEqual({ 'VP Technology Ops': 2, COO: 0 });
  });

  it('lets one vacancy count toward several roles', () => {
    const matched = [item('a', 'Chief Operating Officer, VP Technology Ops')];
    const counts = countMatchedVacanciesByRole(matched, [
      'VP Technology Ops',
      'Chief Operating Officer',
    ]);
    expect(counts).toEqual({ 'VP Technology Ops': 1, 'Chief Operating Officer': 1 });
  });

  it('returns zero for a blank role without matching everything', () => {
    const matched = [item('a', 'VP Technology Ops')];
    expect(countMatchedVacanciesByRole(matched, ['   '])).toEqual({ '   ': 0 });
  });
});
