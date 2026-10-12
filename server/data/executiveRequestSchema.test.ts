import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_41 } from './executiveRequestSchema';

describe('Executive request schema migration (B471)', () => {
  it('is idempotent and removes candidate requests when the candidate is deleted', () => {
    const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT');
    database.exec(MIGRATION_41);
    database.exec(MIGRATION_41);
    database.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-1');
    database
      .prepare(
        'INSERT INTO executive_requests (id, candidate_id, idempotency_digest, payload_digest, request_cipher, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'request-1',
        'candidate-1',
        'idempotency-digest',
        'payload-digest',
        'sealed-request',
        'waitlisted',
        '2026-10-10T08:00:00.000Z',
        '2026-10-10T08:00:00.000Z',
      );

    database.prepare('DELETE FROM candidates WHERE id = ?').run('candidate-1');

    expect(database.prepare('SELECT COUNT(*) AS count FROM executive_requests').get()).toEqual({
      count: 0,
    });
    database.close();
  });
});
