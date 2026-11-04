import { describe, expect, it } from 'vitest';
import type { CampaignResolution } from '../vacancies/campaign';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { runSteps } from '../vacancies/yieldingSteps';
import { finishMatchedRows, finishMatchedRowSteps } from './matchedVacancyList';

const places = ['Москва', 'Berlin, Germany', 'Remote', 'Алматы', 'New York, NY'];

function pool(size: number): MatchedVacancyItem[] {
  return Array.from({ length: size }, (_, index) => ({
    cluster: {
      id: `row-${index}`,
      canonicalTitle: `Инженер ${index % 11}`,
      canonicalCompany: index % 13 === 0 ? 'Иванов Иван Иванович' : `Компания ${index % 17}`,
      canonicalLocation: places[index % places.length],
      isRemote: index % 3 === 0,
      skills: [],
      sources: [],
      lastSeenAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      firstObservedAt: '2026-09-01T00:00:00.000Z',
    },
    explanation: {
      clusterId: `row-${index}`,
      roleMatch: index % 7 === 0 ? 'none' : 'target',
      requirements: { matched: index % 5, total: 5 },
      matchingPoints: [],
      missingPoints: [],
    },
  })) as unknown as MatchedVacancyItem[];
}

const campaign = (regions: readonly string[]) =>
  ({ regions: { value: regions }, remoteOnly: false }) as unknown as CampaignResolution;
const limits = {
  profile: undefined,
  decisions: [
    { clusterId: 'row-5', status: 'skipped', skipReasonId: 'level' },
    { clusterId: 'row-250', status: 'saved' },
  ],
} as unknown as Parameters<typeof finishMatchedRows>[3];

describe('finishing the rows in pieces (PRB-041)', () => {
  it.each([[['russia']], [['russia', 'europe']], [[]]])(
    'gives the same rows in the same order as one piece, regions %j',
    (regions) => {
      const rows = pool(730);
      const whole = finishMatchedRows(rows, ['Инженер'], campaign(regions), limits);
      const pieces = runSteps(finishMatchedRowSteps(rows, ['Инженер'], campaign(regions), limits));
      expect(pieces).toEqual(whole);
      expect(pieces.length).toBeGreaterThan(0);
    },
  );
});
