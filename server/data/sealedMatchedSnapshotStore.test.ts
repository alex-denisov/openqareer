import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SealedMatchedSnapshotStore } from './sealedMatchedSnapshotStore';
import { SealedText } from './sealedText';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function open() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.prepare('INSERT INTO candidates (id) VALUES (?)').run('one');
  return { database, store: new SealedMatchedSnapshotStore(database, new SealedText(Buffer.alloc(32, 7))) };
}

describe('SealedMatchedSnapshotStore', () => {
  it('returns the written text for the same profile and nothing for another one', () => {
    const { store } = open();
    const text = JSON.stringify([{ cluster: { id: 'a', title: 'Директор по ИТ' } }]);
    store.write('one', 'profile', 100, text);

    expect(store.read('one', 'profile')).toEqual({ builtAt: 100, text });
    expect(store.read('one', 'other-profile')).toBeNull();
  });

  it('keeps the campaign snapshot when role snapshots of the same candidate are written (s09)', () => {
    const { store } = open();
    store.write('one', 'campaign', 100, '"campaign"');
    store.write('one', 'role-cto', 101, '"cto"');
    store.write('one', 'role-coo', 102, '"coo"');

    expect(store.read('one', 'campaign')?.text).toBe('"campaign"');
    expect(store.read('one', 'role-cto')?.text).toBe('"cto"');
  });

  it('holds at most 24 profiles of a candidate, dropping the oldest', () => {
    const { database, store } = open();
    for (let built = 1; built <= 30; built += 1) store.write('one', `p${built}`, built, '[]');
    const { n } = database.prepare('SELECT count(*) AS n FROM matched_snapshot_seals').get() as { n: number };

    expect(n).toBe(24);
    expect(store.read('one', 'p6')).toBeNull();
    expect(store.read('one', 'p7')).not.toBeNull();
  });

  it('moves the snapshots of the first table, which held one per candidate, and drops it', () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
    database.prepare('INSERT INTO candidates (id) VALUES (?)').run('one');
    const sealedText = new SealedText(Buffer.alloc(32, 7));
    const written = new SealedMatchedSnapshotStore(database, sealedText);
    written.write('one', 'campaign', 100, '"campaign"');
    database.exec(`ALTER TABLE matched_snapshot_seals RENAME TO sealed_matched_snapshots`);

    const moved = new SealedMatchedSnapshotStore(database, sealedText);

    expect(moved.read('one', 'campaign')?.text).toBe('"campaign"');
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%snapshot%'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(['matched_snapshot_seals']);
  });

  it('keeps the newer build when an older one finishes late', () => {
    const { store } = open();
    store.write('one', 'profile', 200, '"new"');
    store.write('one', 'profile', 100, '"old"');

    expect(store.read('one', 'profile')?.text).toBe('"new"');
  });

  it('stores no readable text and compresses the list', () => {
    const { database, store } = open();
    const text = JSON.stringify(Array.from({ length: 500 }, (_, id) => ({ cluster: { id, title: 'Москва' } })));
    store.write('one', 'profile', 100, text);
    const { cipher } = database.prepare('SELECT cipher FROM matched_snapshot_seals').get() as { cipher: string };

    expect(cipher).not.toContain('Москва');
    expect(cipher.length).toBeLessThan(text.length / 3);
  });

  it('goes with the candidate and on delete', () => {
    const { database, store } = open();
    store.write('one', 'profile', 100, '[]');
    store.delete('one');
    expect(store.read('one', 'profile')).toBeNull();

    store.write('one', 'profile', 100, '[]');
    database.prepare('DELETE FROM candidates WHERE id = ?').run('one');
    expect(store.read('one', 'profile')).toBeNull();
  });
});
