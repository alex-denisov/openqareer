import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteProfileRevisionRepository } from './sqliteProfileRevisionRepository';
import { SealedText } from './sealedText';

describe('SqliteProfileRevisionRepository', () => {
  it('records, lists, gets and marks revisions as reverted', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;
      INSERT INTO candidates (id) VALUES ('cand-1');
    `);
    const repo = new SqliteProfileRevisionRepository(db, new SealedText(Buffer.alloc(32, 7)));

    const revision = repo.recordRevision({
      id: 'rev-1',
      candidateId: 'cand-1',
      commandId: 'cmd-1',
      section: 'about',
      experienceId: null,
      previousText: 'Old about',
      appliedText: 'New about',
      createdAt: '2026-09-28T00:00:00.000Z',
    });

    expect(revision).toEqual({
      id: 'rev-1',
      candidateId: 'cand-1',
      commandId: 'cmd-1',
      section: 'about',
      experienceId: null,
      previousText: 'Old about',
      appliedText: 'New about',
      createdAt: '2026-09-28T00:00:00.000Z',
      revertedAt: null,
    });

    const list = repo.listRevisions('cand-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('rev-1');

    const byCommand = repo.getRevisionByCommandId('cand-1', 'cmd-1');
    expect(byCommand).not.toBeNull();
    expect(byCommand?.appliedText).toBe('New about');
    const encrypted = db
      .prepare('SELECT previous_text_cipher, applied_text_cipher FROM profile_revisions WHERE command_id = ?')
      .get('cmd-1') as { previous_text_cipher: string; applied_text_cipher: string };
    expect(encrypted.previous_text_cipher).not.toContain('Old about');
    expect(encrypted.applied_text_cipher).not.toContain('New about');

    repo.markReverted('cand-1', 'cmd-1', '2026-09-28T00:05:00.000Z');
    const reverted = repo.getRevisionByCommandId('cand-1', 'cmd-1');
    expect(reverted?.revertedAt).toBe('2026-09-28T00:05:00.000Z');

    db.prepare('DELETE FROM candidates WHERE id = ?').run('cand-1');
    expect(repo.listRevisions('cand-1')).toEqual([]);
    db.close();
  });
});
