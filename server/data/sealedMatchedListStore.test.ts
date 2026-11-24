import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SEALED_LISTS_PER_CANDIDATE, SealedMatchedListStore } from './sealedMatchedListStore';
import { SealedText } from './sealedText';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function open() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.prepare('INSERT INTO candidates (id) VALUES (?)').run('one');
  return { database, store: new SealedMatchedListStore(database, new SealedText(Buffer.alloc(32, 7))) };
}

describe('SealedMatchedListStore: a list per choice of the candidate (B770)', () => {
  it('keeps the list of each choice: s07 by role and the general list survive a restart together', () => {
    const { store } = open();
    store.write('one', 100, '"all"', 'all');
    store.write('one', 101, '"cto"', 'role=CTO');

    expect(store.read('one', 0, 'all')).toEqual({ builtAt: 100, text: '"all"', choice: 'all' });
    expect(store.read('one', 0, 'role=CTO')?.text).toBe('"cto"');
    expect(store.read('one', 0, 'role=COO')).toBeNull();
  });

  it('without a choice gives the latest list, for checks and tests', () => {
    const { store } = open();
    store.write('one', 100, '"all"', 'all');
    store.write('one', 101, '"cto"', 'role=CTO');
    expect(store.read('one', 0)?.choice).toBe('role=CTO');
  });

  it('an older build of the same choice does not replace a newer one', () => {
    const { store } = open();
    store.write('one', 2_000, 'newer', 'all');
    store.write('one', 1_000, 'older', 'all');
    expect(store.read('one', 0, 'all')?.text).toBe('newer');
  });

  it('a list built before the limit is not given', () => {
    const { store } = open();
    store.write('one', 100, '"all"', 'all');
    expect(store.read('one', 100, 'all')).toBeNull();
  });

  it(`holds at most ${SEALED_LISTS_PER_CANDIDATE} choices of a candidate, dropping the oldest build`, () => {
    const { database, store } = open();
    for (let index = 0; index <= SEALED_LISTS_PER_CANDIDATE; index += 1)
      store.write('one', 100 + index, `"${index}"`, `choice-${index}`);

    expect(store.read('one', 0, 'choice-0')).toBeNull();
    expect(store.read('one', 0, `choice-${SEALED_LISTS_PER_CANDIDATE}`)).not.toBeNull();
    expect(database.prepare('SELECT COUNT(*) AS n FROM sealed_matched_list_choices').get()).toEqual({
      n: SEALED_LISTS_PER_CANDIDATE,
    });
  });

  it('a list sealed under one choice does not open under another', () => {
    const { database, store } = open();
    store.write('one', 100, '"all"', 'all');
    database.prepare("UPDATE sealed_matched_list_choices SET choice = 'role=CTO'").run();
    expect(() => store.read('one', 0, 'role=CTO')).toThrow();
  });

  it('goes with the account', () => {
    const { database, store } = open();
    store.write('one', 100, '"all"', 'all');
    database.prepare('DELETE FROM candidates WHERE id = ?').run('one');
    expect(database.prepare('SELECT COUNT(*) AS n FROM sealed_matched_list_choices').get()).toEqual({ n: 0 });
  });
});
