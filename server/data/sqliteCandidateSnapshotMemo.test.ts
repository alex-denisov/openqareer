import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
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

  it('drops the memo when another connection commits', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'oq-snap-')), 'db.sqlite');
    const store = createStore(path);
    const candidate = createCandidate(store);
    const first = store.getSnapshot(candidate.id);
    const other = new DatabaseSync(path);
    other.exec('CREATE TABLE IF NOT EXISTS memo_probe (x INTEGER)');
    other.close();
    expect(store.getSnapshot(candidate.id)).not.toBe(first);
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
