import { describe, expect, it } from 'vitest';
import { addStoredVacancyLevels, dropOutsideLevelGate } from './storedVacancyLevels';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { campaignLevelWindow } from './titleParse/candidateRoleFunctions';

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
    expect(result[0].explanation.vacancyLevel).toBe('vp');
  });

  it('sends no vacancy level when the title gives none', () => {
    const result = addStoredVacancyLevels([item()], 'vp', () => ({ levelRank: null }));

    expect(result[0].explanation.levelMatch).toBe('unknown');
    expect(result[0].explanation.vacancyLevel).toBeUndefined();
  });
});

describe('dropOutsideLevelGate', () => {
  const titled = (canonicalTitle: string): MatchedVacancyItem => {
    const base = item();
    return { ...base, cluster: { ...base.cluster, canonicalTitle } };
  };
  const roles = ['VP of Engineering', 'AI Consultant'];
  const parses: Record<string, { functions: string[]; levelRank: number | null }> = {
    'team lead c++': { functions: ['eng', 'eng-mgmt'], levelRank: 1 },
    'vp of engineering': { functions: ['eng-mgmt'], levelRank: 3 },
    'ai consultant': { functions: ['ai-ml', 'consulting'], levelRank: 0 },
  };
  const kept = (titles: string[]) =>
    dropOutsideLevelGate(titles.map(titled), campaignLevelWindow(roles, 'vp'), 'vp', (key) => parses[key]).map(
      (row) => row.cluster.canonicalTitle,
    );

  it('строка, которую ворота отвергнут, в подборку не идёт', () => {
    expect(kept(['Team Lead C++', 'VP of Engineering', 'AI Consultant', 'Куратор'])).toEqual([
      'VP of Engineering',
      'AI Consultant',
      'Куратор',
    ]);
  });

  it('без известного уровня кандидата ничего не отсекает', () => {
    const rows = [titled('Team Lead C++')];
    expect(
      dropOutsideLevelGate(rows, campaignLevelWindow(roles, undefined), undefined, (key) => parses[key]),
    ).toHaveLength(1);
  });

  it('подбор без функций ролей окно не сужает: рядовая строка у бывшего руководителя остаётся', () => {
    const rows = [titled('Team Lead C++')];
    expect(
      dropOutsideLevelGate(rows, campaignLevelWindow([], 'head'), 'head', (key) => parses[key]),
    ).toHaveLength(1);
  });
});
