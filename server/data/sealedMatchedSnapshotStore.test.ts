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
    const { cipher } = database.prepare('SELECT cipher FROM sealed_matched_snapshots').get() as { cipher: string };

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
