import { describe, expect, it } from 'vitest';
import { applyVacancyDecisions } from './applyVacancyDecisions';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

function item(clusterId: string): MatchedVacancyItem {
  return {
    cluster: {
      id: clusterId,
      canonicalTitle: 'Lead Frontend Engineer',
      canonicalCompany: 'Tech Unicorn',
      isRemote: true,
      skills: [],
      primaryUrl: `https://example.com/${clusterId}`,
      sources: [],
      firstObservedAt: '2026-08-18T00:00:00.000Z',
      lastSeenAt: '2026-08-18T00:00:00.000Z',
      descriptionSummary: '',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId,
      roleMatch: 'target',
      levelMatch: 'unknown',
      matchingPoints: [],
      missingPoints: [],
      summary: 'summary',
      calculatedAt: '2026-08-18T00:00:00.000Z',
    },
  };
}

describe('applyVacancyDecisions (B248)', () => {
  it('leaves vacancies without a decision untouched', () => {
    const result = applyVacancyDecisions([item('a')], []);
    expect(result).toHaveLength(1);
    expect(result[0].explanation.candidateDecision).toBeUndefined();
  });

  it('marks a saved vacancy with its decision, keeping it in place', () => {
    const result = applyVacancyDecisions(
      [item('a'), item('b')],
      [{ clusterId: 'a', status: 'saved' }],
    );
    expect(result.map((entry) => entry.cluster.id)).toEqual(['a', 'b']);
    expect(result[0].explanation.candidateDecision).toEqual({ status: 'saved' });
  });

  it.each(['role-family', 'comp-below', 'stale'] as const)(
    'hides a vacancy skipped for any reason (%s)',
    (skipReasonId) => {
      const result = applyVacancyDecisions(
        [item('a'), item('b')],
        [{ clusterId: 'a', status: 'skipped', skipReasonId }],
      );
      expect(result.map((entry) => entry.cluster.id)).toEqual(['b']);
    },
  );
});
