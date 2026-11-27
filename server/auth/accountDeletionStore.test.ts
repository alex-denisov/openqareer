import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { AutoApplyPauseSnapshot } from '../candidate/sqliteCandidateStatusRepository';
import { ACCOUNT_DELETION_GRACE_DAYS, SqliteAccountDeletionStore } from './accountDeletionStore';

const NOW = new Date('2026-11-19T10:00:00.000Z');
const SNAPSHOT: AutoApplyPauseSnapshot = {
  appliedUntil: '2027-11-19T10:00:00.000Z',
  previousPausedUntil: null,
  previousRuntime: { status: 'idle', pauseUntil: null, nextSendAt: null },
  wasPaused: false,
  runtimeTouched: true,
  killSwitchSetAt: '2026-11-19T10:00:00.000Z',
};

function store() {
  return new SqliteAccountDeletionStore(new DatabaseSync(':memory:'));
}

describe('SqliteAccountDeletionStore', () => {
  it('schedules the purge 30 days ahead and keeps the pause snapshot', () => {
    const deletions = store();
    const request = deletions.schedule('cand-1', NOW, SNAPSHOT);
    expect(ACCOUNT_DELETION_GRACE_DAYS).toBe(30);
    expect(request).toEqual({
      candidateId: 'cand-1',
      requestedAt: '2026-11-19T10:00:00.000Z',
      purgeAfter: '2026-12-19T10:00:00.000Z',
      pause: SNAPSHOT,
    });
    expect(deletions.get('cand-1')).toEqual(request);
  });

  it('does not move the deadline when deletion is requested again', () => {
    const deletions = store();
    const first = deletions.schedule('cand-1', NOW, SNAPSHOT);
    const again = deletions.schedule('cand-1', new Date('2026-11-25T10:00:00.000Z'), null);
    expect(again).toEqual(first);
  });

  it('cancels a request and reports whether there was one', () => {
    const deletions = store();
    deletions.schedule('cand-1', NOW, null);
    expect(deletions.cancel('cand-1')?.pause).toBeNull();
    expect(deletions.get('cand-1')).toBeNull();
    expect(deletions.cancel('cand-1')).toBeNull();
  });

  it('lists only requests whose deadline has passed, oldest first', () => {
    const deletions = store();
    deletions.schedule('cand-late', new Date('2026-11-20T10:00:00.000Z'), null);
    deletions.schedule('cand-early', NOW, null);
    deletions.schedule('cand-new', new Date('2026-12-15T10:00:00.000Z'), null);
    const due = deletions.listDue(new Date('2026-12-21T00:00:00.000Z'), 10);
    expect(due.map((request) => request.candidateId)).toEqual(['cand-early', 'cand-late']);
    expect(deletions.listDue(new Date('2026-12-19T09:59:59.000Z'), 10)).toEqual([]);
  });

  it('reads a broken snapshot as no snapshot', () => {
    const database = new DatabaseSync(':memory:');
    const deletions = new SqliteAccountDeletionStore(database);
    deletions.schedule('cand-1', NOW, SNAPSHOT);
    database.prepare('UPDATE candidate_account_deletions SET pause_snapshot = ?').run('{broken');
    expect(deletions.get('cand-1')?.pause).toBeNull();
  });
});
