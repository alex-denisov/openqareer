import { describe, expect, it } from 'vitest';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import { createCandidate, createStore } from './sqliteTestHarness';

const WORKSPACE: CandidateWorkspaceState = {
  resumeText: 'VP Technology Operations',
  resumeSource: 'text',
  targetDirection: 'VP Technology Operations',
  regions: ['mena'],
  currentSituation: 'Ищет следующую роль.',
  constraints: '',
  urgency: 'active',
};

describe('candidate workspace visit marks', () => {
  it('stores the last visit in encrypted workspace JSON and advances it no more than every 30 minutes', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    store.saveCandidateWorkspace(candidate.id, WORKSPACE);
    const first = '2026-09-24T10:00:00.000Z';

    expect(store.recordCandidateVisit(candidate.id, first)).toEqual({ since: null });
    expect(store.getCandidateWorkspace(candidate.id)).toMatchObject({
      lastVisitedAt: first,
      previousVisitedAt: first,
    });

    const beforeBoundary = store.recordCandidateVisit(candidate.id, '2026-09-24T10:29:59.000Z');
    expect(beforeBoundary.since).toBe(first);
    expect(store.getCandidateWorkspace(candidate.id)?.lastVisitedAt).toBe(first);

    const boundary = store.recordCandidateVisit(candidate.id, '2026-09-24T10:30:00.000Z');
    expect(boundary.since).toBe(first);
    expect(store.getCandidateWorkspace(candidate.id)).toMatchObject({
      lastVisitedAt: '2026-09-24T10:30:00.000Z',
      previousVisitedAt: first,
    });
    expect(store.getSinceLastVisit(candidate.id)).toBe(first);
  });

  it('keeps workspace visit marks isolated by candidate', () => {
    const store = createStore();
    const first = createCandidate(store);
    const second = createCandidate(store);
    store.saveCandidateWorkspace(first.id, WORKSPACE);
    store.saveCandidateWorkspace(second.id, WORKSPACE);

    store.recordCandidateVisit(first.id, '2026-09-24T10:00:00.000Z');

    expect(store.getSinceLastVisit(first.id)).toBe('2026-09-24T10:00:00.000Z');
    expect(store.getSinceLastVisit(second.id)).toBeNull();
    expect(store.getCandidateWorkspace(second.id)?.lastVisitedAt).toBeUndefined();
  });
});
