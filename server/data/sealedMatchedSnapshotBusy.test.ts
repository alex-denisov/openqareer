import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SealedMatchedSnapshotStore } from './sealedMatchedSnapshotStore';
import { SealedText } from './sealedText';

vi.mock('node:zlib', async (importActual) => {
  const actual = await importActual<typeof import('node:zlib')>();
  return { ...actual, gzipSync: vi.fn(actual.gzipSync) };
});

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function twoConnections() {
  const dir = mkdtempSync(join(tmpdir(), 'sealed-snapshot-'));
  const path = join(dir, 'db.sqlite');
  const web = new DatabaseSync(path);
  web.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;');
  web.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  web.prepare('INSERT INTO candidates (id) VALUES (?)').run('one');
  const store = new SealedMatchedSnapshotStore(web, new SealedText(Buffer.alloc(32, 7)));
  const other = new DatabaseSync(path);
  cleanups.push(() => {
    other.close();
    web.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { web, store, other };
}

describe('SealedMatchedSnapshotStore.write leaves the event loop free (B770, prod 24.11)', () => {
  it('another connection holds the lock: the loop runs the timer that frees it, and the row is written', async () => {
    const { web, store, other } = twoConnections();
    other.exec('BEGIN IMMEDIATE');
    // A write that waits on the loop never lets this timer run and fails as busy.
    setTimeout(() => other.exec('ROLLBACK'), 400);

    await store.write('one', 'profile', 100, '"all"');

    expect(store.read('one', 'profile')?.text).toBe('"all"');
    expect(web.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 2000 });
  });

  it('the list is compressed off the loop', async () => {
    const { store } = twoConnections();
    const text = JSON.stringify(Array.from({ length: 1_000 }, (_, id) => `${id}:${id * 7919}`));

    const written = store.write('one', 'profile', 100, text);
    expect(store.read('one', 'profile')).toBeNull();
    await written;

    expect(gzipSync).not.toHaveBeenCalled();
    expect(store.read('one', 'profile')?.text).toBe(text);
  });

  it('a snapshot dropped while it waits for the lock is not written back', async () => {
    const { store, other } = twoConnections();
    let wanted = true;
    other.exec('BEGIN IMMEDIATE');
    setTimeout(() => {
      wanted = false;
      other.exec('ROLLBACK');
    }, 100);

    await store.write('one', 'profile', 100, '"all"', () => wanted);

    expect(store.read('one', 'profile')).toBeNull();
  });
});
