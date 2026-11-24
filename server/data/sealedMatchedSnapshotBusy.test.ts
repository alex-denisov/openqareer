import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { SealedMatchedSnapshotStore } from './sealedMatchedSnapshotStore';
import { SealedText } from './sealedText';

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

/** The largest pause between loop turns while `work` runs. */
async function longestBlock(work: () => void | Promise<void>): Promise<number> {
  let longest = 0;
  let last = performance.now();
  let running = true;
  const tick = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  await work();
  await new Promise((resolve) => setImmediate(resolve));
  running = false;
  return longest;
}

describe('SealedMatchedSnapshotStore.write leaves the event loop free (B770, prod 24.11)', () => {
  it('another connection holds the lock: the loop keeps turning and the row is written after it', async () => {
    const { web, store, other } = twoConnections();
    other.exec('BEGIN IMMEDIATE');
    setTimeout(() => other.exec('ROLLBACK'), 400);

    const longest = await longestBlock(() => store.write('one', 'profile', 100, '"all"'));

    expect(longest).toBeLessThan(350);
    expect(store.read('one', 'profile')?.text).toBe('"all"');
    expect(web.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 2000 });
  });

  it('the list is compressed off the loop', async () => {
    const { store } = twoConnections();
    const text = JSON.stringify(Array.from({ length: 300_000 }, (_, id) => `${id}:${id * 7919}`));
    const startedAt = performance.now();
    gzipSync(Buffer.from(text, 'utf8'));
    const gzipMs = performance.now() - startedAt;

    const longest = await longestBlock(() => store.write('one', 'profile', 100, text));

    expect(longest).toBeLessThan(gzipMs * 0.75);
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
