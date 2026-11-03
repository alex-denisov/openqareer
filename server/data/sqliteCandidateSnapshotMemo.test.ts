import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { FOREIGN_COMMIT_GRACE_MS } from './sqliteSnapshotMemo';
import { createCandidate, createStore } from './sqliteTestHarness';

describe('getSnapshot memo', () => {
  it('reuses one decrypted snapshot until something writes', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const first = store.getSnapshot(candidate.id);
    expect(store.getSnapshot(candidate.id)).toBe(first);

    store.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'QA lead' }, []);
    const after = store.getSnapshot(candidate.id);
    expect(after).not.toBe(first);
    expect(after.resume?.draft.targetRole).toBe('QA lead');
  });

  it('keeps the memo through another connection\'s commit for a short while, then reads again', () => {
    // Prod 03.11: the fit queue, sessions and the worker commit every second through their own
    // connections, so a memo dropped on any commit re-read the dossier on every /fit call and every
    // sweep chunk (11.5 of 40 busy seconds). The snapshot tables are written through this store.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const path = join(mkdtempSync(join(tmpdir(), 'oq-snap-')), 'db.sqlite');
      const store = createStore(path, FOREIGN_COMMIT_GRACE_MS);
      const candidate = createCandidate(store);
      const first = store.getSnapshot(candidate.id);
      const other = new DatabaseSync(path);
      other.exec('CREATE TABLE IF NOT EXISTS memo_probe (x INTEGER)');
      other.close();
      expect(store.getSnapshot(candidate.id)).toBe(first);
      vi.advanceTimersByTime(FOREIGN_COMMIT_GRACE_MS + 1);
      const reread = store.getSnapshot(candidate.id);
      expect(reread).not.toBe(first);
      // Without commits a kept snapshot has no age limit.
      vi.advanceTimersByTime(10 * FOREIGN_COMMIT_GRACE_MS);
      expect(store.getSnapshot(candidate.id)).toBe(reread);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the memo at once on another connection\'s commit unless the store opts in (the worker)', () => {
    // The mechanics worker checks a fit against the current profile: the web process's writes are
    // foreign to it and must be seen at once.
    const path = join(mkdtempSync(join(tmpdir(), 'oq-snap-')), 'db.sqlite');
    const store = createStore(path);
    const candidate = createCandidate(store);
    const first = store.getSnapshot(candidate.id);
    const other = new DatabaseSync(path);
    other.exec('CREATE TABLE IF NOT EXISTS memo_probe (x INTEGER)');
    other.close();
    expect(store.getSnapshot(candidate.id)).not.toBe(first);
  });

  it('drops the memo at once on a write through its own connection', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'oq-snap-')), 'db.sqlite');
    const store = createStore(path, FOREIGN_COMMIT_GRACE_MS);
    const candidate = createCandidate(store);
    store.getSnapshot(candidate.id);
    const other = new DatabaseSync(path);
    other.exec('CREATE TABLE IF NOT EXISTS memo_probe (x INTEGER)');
    other.close();
    store.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'CTO' }, []);
    expect(store.getSnapshot(candidate.id).resume?.draft.targetRole).toBe('CTO');
  });

  it('never keeps a snapshot read inside a transaction', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const database = (store as unknown as { database: DatabaseSync }).database;
    database.exec('BEGIN');
    const inside = store.getSnapshot(candidate.id);
    database.exec('ROLLBACK');
    expect(store.getSnapshot(candidate.id)).not.toBe(inside);
  });
});
