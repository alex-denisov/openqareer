import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateDraftRepository } from './sqliteCandidateDraftRepository';

describe('candidate draft storage', () => {
  it('deletes stored drafts when the candidate deletes their account', () => {
    const directory = mkdtempSync(join(tmpdir(), 'candidate-drafts-'));
    const databasePath = join(directory, 'store.db');
    const store = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 7) });
    const db = new DatabaseSync(databasePath);
    const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const repo = new SqliteCandidateDraftRepository(db);
    repo.create({
      candidateId: candidate.id,
      kind: 'post',
      topic: 'Опыт',
      text: 'Мой опыт.',
      localDate: '2026-09-30',
    });
    expect(store.deleteCandidate(candidate.id)).toBe(true);
    expect(repo.listRecent(candidate.id)).toEqual([]);
    expect(() =>
      repo.create({
        candidateId: candidate.id,
        kind: 'post',
        topic: 'Опыт',
        text: 'Опоздавший.',
        localDate: '2026-09-30',
      }),
    ).toThrow('candidate_not_found');
    db.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it('persists drafts, scopes reads and status changes, and counts local days by kind', () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateDraftRepository(db);
    const draft = repo.create({
      candidateId: 'alice',
      kind: 'comment',
      topic: 'Опыт',
      text: 'Мой опыт.',
      localDate: '2026-09-30',
    });
    expect(repo.listRecent('alice')).toEqual([draft]);
    expect(repo.listRecent('bob')).toEqual([]);
    expect(repo.setStatus('bob', draft.id, 'copied')).toBeNull();
    expect(repo.setStatus('alice', draft.id, 'copied')?.status).toBe('copied');
    expect(repo.countForDay('alice', '2026-09-30', 'comment')).toBe(1);
    expect(repo.countForDay('alice', '2026-09-29', 'comment')).toBe(0);
    expect(repo.countForDay('alice', '2026-09-30', 'post')).toBe(0);
    db.close();
  });
});
