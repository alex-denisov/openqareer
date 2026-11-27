import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SEAL_BUSY_TIMEOUT_MS, SealedMatchedListStore } from './sealedMatchedListStore';
import { SealedText } from './sealedText';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function twoConnections() {
  const dir = mkdtempSync(join(tmpdir(), 'sealed-busy-'));
  const path = join(dir, 'db.sqlite');
  const web = new DatabaseSync(path);
  web.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 20000;');
  web.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  web.prepare('INSERT INTO candidates (id) VALUES (?)').run('one');
  const store = new SealedMatchedListStore(web, new SealedText(Buffer.alloc(32, 7)));
  const other = new DatabaseSync(path);
  cleanups.push(() => {
    other.close();
    web.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { web, store, other };
}

describe('SealedMatchedListStore.write: чужая запись держит базу (B776, прод 23.11)', () => {
  it('ждёт не дольше короткого порога и пропускает запись без исключения', () => {
    const { web, store, other } = twoConnections();
    other.exec('BEGIN IMMEDIATE');
    const startedAt = performance.now();
    const result = store.write('one', 100, '"all"', 'all');
    const waited = performance.now() - startedAt;
    other.exec('ROLLBACK');

    expect(result).toEqual({ skipped: 'busy', lockWaitMs: expect.any(Number) });
    expect(waited).toBeLessThan(SEAL_BUSY_TIMEOUT_MS + 500);
    expect(store.read('one', 0, 'all')).toBeNull();
    // Остальные записи веб-процесса ждут, как прежде.
    expect(web.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 20000 });
  });

  it('без чужой записи пишет, как прежде, и возвращает прежнее ожидание', () => {
    const { web, store } = twoConnections();
    const result = store.write('one', 100, '"all"', 'all');
    expect(result).toEqual({ heldMs: expect.any(Number), lockWaitMs: expect.any(Number) });
    expect(store.read('one', 0, 'all')?.text).toBe('"all"');
    expect(web.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 20000 });
  });
});
