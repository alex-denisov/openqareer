import { describe, expect, it } from 'vitest';
import {
  apiErrorMessage,
  isVersionConflict,
  optimisticStagePatch,
  replaceApplication,
  withKey,
  withoutKey,
} from './applicationListOps';
import { CoachApiError } from '../coach/apiClient';
import type { ApplicationView } from './applicationsApi';

function card(id: string, stage: ApplicationView['stage'] = 'saved'): ApplicationView {
  return {
    id,
    candidateId: 'cand-1',
    clusterId: `cluster-${id}`,
    stage,
    closedReason: null,
    processProfile: 'standard',
    vacancy: { title: `Role ${id}`, company: 'Acme', url: 'https://example.com', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-01T00:00:00.000Z',
    version: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
    nearestInterview: null,
  };
}

describe('replaceApplication', () => {
  it('swaps in the card with the same id and leaves the rest alone', () => {
    const list = [card('a'), card('b')];
    const updated = { ...card('a'), version: 2 };
    expect(replaceApplication(list, updated)).toEqual([updated, card('b')]);
  });
});

describe('optimisticStagePatch', () => {
  it('moves one card to a new stage without touching siblings', () => {
    const list = [card('a'), card('b')];
    const result = optimisticStagePatch(list, 'a', { stage: 'applied' });
    expect(result[0].stage).toBe('applied');
    expect(result[1]).toBe(list[1]);
  });
});

describe('isVersionConflict', () => {
  it('recognizes the 409 code the server sends for a stale expectedVersion', () => {
    expect(isVersionConflict(new CoachApiError('msg', 'application_version_conflict', false))).toBe(
      true,
    );
  });

  it('is false for any other error', () => {
    expect(isVersionConflict(new CoachApiError('msg', 'network_error', true))).toBe(false);
    expect(isVersionConflict(new Error('boom'))).toBe(false);
    expect(isVersionConflict(undefined)).toBe(false);
  });
});

describe('map helpers', () => {
  it('adds and removes keys without mutating the source map', () => {
    const empty = new Map<string, number>();
    const withA = withKey(empty, 'a', 1);
    expect(empty.size).toBe(0);
    expect(withA.get('a')).toBe(1);
    const removed = withoutKey(withA, 'a');
    expect(withA.has('a')).toBe(true);
    expect(removed.has('a')).toBe(false);
    expect(withoutKey(removed, 'missing')).toBe(removed);
  });
});

describe('apiErrorMessage', () => {
  it('surfaces the candidate-facing message from a CoachApiError', () => {
    expect(apiErrorMessage(new CoachApiError('Не сохранилось', 'x', true), 'fallback')).toBe(
      'Не сохранилось',
    );
  });

  it('falls back to the given text for anything else', () => {
    expect(apiErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});
