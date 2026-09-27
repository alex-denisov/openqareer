import { describe, expect, it } from 'vitest';
import { addStoredVacancyLevels } from './storedVacancyLevels';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

function item(): MatchedVacancyItem {
  return {
    cluster: {
      id: 'cluster-1',
      canonicalTitle: 'Lead Frontend Engineer',
      canonicalCompany: 'Tech Unicorn',
      isRemote: true,
      skills: [],
      primaryUrl: 'https://example.test/job',
      sources: [],
      firstObservedAt: '2026-09-24T00:00:00.000Z',
      lastSeenAt: '2026-09-24T00:00:00.000Z',
      descriptionSummary: '',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: 'cluster-1',
      roleMatch: 'target',
      levelMatch: 'below',
      matchingPoints: [],
      missingPoints: [],
      summary: 'summary',
      calculatedAt: '2026-09-24T00:00:00.000Z',
    },
  };
}

describe('addStoredVacancyLevels', () => {
  it('uses the same persisted title level for any matched-snapshot consumer', () => {
    const result = addStoredVacancyLevels([item()], 'vp', () => ({ levelRank: 3 }));

    expect(result[0].explanation.levelMatch).toBe('match');
  });
});
