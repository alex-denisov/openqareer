import { describe, expect, it } from 'vitest';
import { deriveApplicationFields } from './applicationDerivedFields';
import type { StoredApplication, StoredApplicationEvent } from '../data/sqliteApplicationRepository';

function application(overrides: Partial<StoredApplication> = {}): StoredApplication {
  return {
    id: 'app-1',
    candidateId: 'candidate-1',
    clusterId: 'cluster-1',
    stage: 'applied',
    closedReason: null,
    processProfile: 'standard',
    vacancy: null,
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2024-01-01T09:00:00Z',
    version: 1,
    createdAt: '2024-01-01T09:00:00Z',
    updatedAt: '2024-01-01T09:00:00Z',
    ...overrides,
  };
}

function stageEvent(toStage: StoredApplicationEvent['toStage'], occurredAt: string): StoredApplicationEvent {
  return { id: 'e', kind: 'stage', fromStage: null, toStage, occurredAt, recordedAt: occurredAt, provenance: 'candidate' };
}

describe('deriveApplicationFields', () => {
  it('has no follow-up for a saved card and marks the candidate’s turn without materials', () => {
    const result = deriveApplicationFields({
      application: application({ stage: 'saved' }),
      events: [],
      materials: [],
      interviews: [],
      now: '2024-01-10T09:00:00Z',
    });
    expect(result.followUp).toBeNull();
    expect(result.whoseTurn).toBe('candidate');
  });

  it('computes follow-up from the last of applied/follow-up-sent/responded events', () => {
    const events = [
      stageEvent('applied', '2024-01-01T09:00:00Z'),
      { id: 'f', kind: 'follow_up_sent' as const, fromStage: null, toStage: null, occurredAt: '2024-01-08T09:00:00Z', recordedAt: '2024-01-08T09:00:00Z', provenance: 'candidate' as const },
    ];
    const result = deriveApplicationFields({
      application: application(),
      events,
      materials: [{ role: 'cover_letter', documentId: 'd', linkedAt: '2024-01-01T09:00:00Z' }],
      interviews: [],
      now: '2024-01-09T09:00:00Z',
    });
    // Last contact is the follow-up sent on 01-08; the next UTC day is upcoming.
    expect(result.followUp?.daysSinceContact).toBe(1);
    expect(result.whoseTurn).toBe('company');
  });

  it('flags an interview inside 72h without prep as the candidate’s turn', () => {
    const result = deriveApplicationFields({
      application: application({ stage: 'interview' }),
      events: [],
      materials: [],
      interviews: [{ id: 'i1', applicationId: 'app-1', round: 1, scheduledAt: '2024-01-10T12:00:00Z', format: null, prepStatus: 'none', prep: null, debrief: null, createdAt: '', updatedAt: '' }],
      now: '2024-01-10T00:00:00Z',
    });
    expect(result.nearestInterview?.id).toBe('i1');
    expect(result.whoseTurn).toBe('candidate');
  });

  it('marks the offer stage as the candidate’s turn', () => {
    const result = deriveApplicationFields({
      application: application({ stage: 'offer' }),
      events: [],
      materials: [],
      interviews: [],
      now: '2024-01-10T00:00:00Z',
    });
    expect(result.whoseTurn).toBe('candidate');
  });
});
