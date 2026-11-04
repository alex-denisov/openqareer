import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { watchWriteHolds, type WriteHold } from './sqliteWriteHolds';

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function setup(thresholdMs = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'write-holds-'));
  const holds: WriteHold[] = [];
  const stop = watchWriteHolds((hold) => holds.push(hold), thresholdMs);
  const database = new DatabaseSync(join(directory, 'holds.db'));
  database.exec('CREATE TABLE secret_notes (id INTEGER PRIMARY KEY, body TEXT)');
  holds.length = 0;
  cleanups.push(() => {
    stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { database, holds, stop };
}

describe('watchWriteHolds (PRB-041: holds of 2–4 s stayed unnamed)', () => {
  it('names a transaction by its first write and counts its writes', () => {
    const { database, holds } = setup();

    database.exec('BEGIN IMMEDIATE');
    database.prepare('INSERT INTO secret_notes (body) VALUES (?)').run('private text');
    database.prepare('DELETE FROM secret_notes WHERE id = ?').run(1);
    database.exec('COMMIT');

    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      statement: 'INSERT INTO secret_notes',
      writes: 2,
      waitIncluded: false,
    });
    expect(holds[0]?.heldMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(holds[0])).not.toContain('private text');
  });

  it('reports a write outside a transaction, whose time may include the wait for the lock', () => {
    const { database, holds } = setup();

    database.prepare('UPDATE secret_notes SET body = ? WHERE id = ?').run('x', 1);

    expect(holds).toEqual([
      expect.objectContaining({ statement: 'UPDATE secret_notes', writes: 1, waitIncluded: true }),
    ]);
  });

  it('sees a write that returns rows', () => {
    const { database, holds } = setup();

    database.prepare('INSERT INTO secret_notes (body) VALUES (?) RETURNING id').get('x');

    expect(holds[0]?.statement).toBe('INSERT INTO secret_notes');
  });

  it('counts a deferred transaction only from its first write', () => {
    const { database, holds } = setup();

    database.exec('BEGIN');
    database.prepare('SELECT count(*) FROM secret_notes').get();
    database.exec('COMMIT');
    expect(holds).toEqual([]);

    database.exec('BEGIN');
    database.prepare('INSERT INTO secret_notes (body) VALUES (?)').run('x');
    database.exec('COMMIT');
    expect(holds).toEqual([expect.objectContaining({ statement: 'INSERT INTO secret_notes' })]);
  });

  it('reports a rolled back transaction too: the lock was held all the same', () => {
    const { database, holds } = setup();

    database.exec('BEGIN IMMEDIATE');
    database.prepare('INSERT INTO secret_notes (body) VALUES (?)').run('x');
    database.exec('ROLLBACK');

    expect(holds).toHaveLength(1);
  });

  it('stays quiet about reads and about holds under the threshold', () => {
    const { database, holds } = setup(60_000);

    database.prepare('SELECT count(*) FROM secret_notes').all();
    database.exec('BEGIN IMMEDIATE');
    database.prepare('INSERT INTO secret_notes (body) VALUES (?)').run('x');
    database.exec('COMMIT');

    expect(holds).toEqual([]);
  });

  it('stops watching when told to', () => {
    const { database, holds, stop } = setup();

    stop();
    database.prepare('INSERT INTO secret_notes (body) VALUES (?)').run('x');

    expect(holds).toEqual([]);
  });
});
