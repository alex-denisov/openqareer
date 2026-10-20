import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_PRO_TRIAL } from './proTrialSchema';
import { hasActiveProTrial, insertProTrial, readProTrial } from './proTrial';

describe('server-owned Pro trial lifetime', () => {
  it('ends at exactly 24 hours, isolates users, rejects reuse and is deleted with its owner', () => {
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    try {
      db.exec(
        "CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('one'), ('two');",
      );
      db.exec(MIGRATION_PRO_TRIAL);
      const now = '2026-10-19T12:00:00.000Z';
      expect(insertProTrial(db, 'one', now)).toBe(true);
      expect(insertProTrial(db, 'one', '2026-10-20T13:00:00.000Z')).toBe(false);
      expect(hasActiveProTrial(db, 'one', '2026-10-20T11:59:59.999Z')).toBe(true);
      expect(hasActiveProTrial(db, 'one', '2026-10-20T12:00:00.000Z')).toBe(false);
      expect(hasActiveProTrial(db, 'one', '2026-10-19T11:59:59.999Z')).toBe(false);
      expect(hasActiveProTrial(db, 'two', now)).toBe(false);
      expect(readProTrial(db, 'two', now, false).status).toBe('eligible');
      expect(readProTrial(db, 'one', now, true).status).toBe('unavailable');
      db.prepare('DELETE FROM users WHERE id = ?').run('one');
      expect(db.prepare('SELECT COUNT(*) AS n FROM billing_pro_trials').get()?.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
