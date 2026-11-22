import { describe, expect, it } from 'vitest';
import { recordingRepositoryForTests } from '../testHelpers/recordingRepositoryForTests';

describe('failInterrupted', () => {
  it('fails only segments that have waited longer than the stale window', () => {
    const repository = recordingRepositoryForTests();
    const recordingId = repository.create({
      candidateId: 'c',
      applicationId: 'a',
      interviewId: 'i',
      tokenHash: 'ab',
      tokenExpiresAt: '2030-01-01T00:00:00.000Z',
    });
    const add = (segment: number, at: string) =>
      repository.insertSegmentIfNew(
        { recordingId, track: 'mic', segment, startedAt: at, durationMs: 1 },
        at,
      );
    add(0, '2026-11-22T10:00:00.000Z');
    add(1, '2026-11-22T10:15:00.000Z');

    // A deploy at 10:16: the old process may still be transcribing segment 1.
    expect(repository.failInterrupted('2026-11-22T10:06:00.000Z')).toBe(1);

    const statuses = repository.listSegments(recordingId).map((row) => row.status);
    expect(statuses).toEqual(['failed', 'pending']);
  });
});

describe('insertSegmentIfNew', () => {
  it('does not take a segment for a finished or deleted recording (the token was checked before the upload)', () => {
    const repository = recordingRepositoryForTests();
    const recording = () =>
      repository.create({
        candidateId: 'c',
        applicationId: 'a',
        interviewId: 'i',
        tokenHash: 'ab',
        tokenExpiresAt: '2030-01-01T00:00:00.000Z',
      });
    const segment = (recordingId: string) => ({
      recordingId,
      track: 'mic' as const,
      segment: 0,
      startedAt: '2026-11-22T10:00:00.000Z',
      durationMs: 1,
    });
    const finished = recording();
    repository.finish(finished, 1, 0);
    const deleted = recording();
    repository.deleteRecording(deleted);

    expect(repository.insertSegmentIfNew(segment(finished))).toBe(false);
    expect(repository.insertSegmentIfNew(segment(deleted))).toBe(false);
    expect(repository.listSegments(finished)).toEqual([]);
  });
});

