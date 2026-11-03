import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { mobileChannelGroups } from './ResponsesMobileChannels';

function application(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cl1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title: 'Head of Platform', company: 'Вектор Банк', url: 'https://x', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-06T10:00:00.000Z',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    ...overrides,
  };
}

describe('mobileChannelGroups', () => {
  it('adds «Всего» only when there are several channels', () => {
    const hh = application({ id: 'h1' });
    const linkedin = application({
      id: 'l1',
      vacancy: { title: 'VP', company: 'Каскад', url: 'https://x', source: 'linkedin' },
    });
    expect(mobileChannelGroups([hh]).map((group) => group.label)).not.toContain('Всего');
    const groups = mobileChannelGroups([hh, linkedin]);
    expect(groups.at(-1)).toMatchObject({ label: 'Всего', total: 2 });
  });

  it('is empty without responses', () => {
    expect(mobileChannelGroups([])).toEqual([]);
  });
});
