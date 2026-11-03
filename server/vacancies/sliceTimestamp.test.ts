import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  vi.useRealTimers();
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openStore(): SqliteVacancyPoolStore {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-slice-ts-'));
  directories.push(directory);
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  stores.push(store);
  return store;
}

const vacancy = (id: string): UnifiedVacancy =>
  ({
    id,
    title: `Engineer ${id}`,
    company: 'Acme',
    location: 'Berlin',
    isRemote: false,
    description: 'Builds things',
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'src-hh-search',
      sourceUrl: `https://example.test/${id}`,
      observedAt: '2026-11-03T10:00:00.000Z',
    },
    publishedAt: '2026-11-03T10:00:00.000Z',
    status: 'active',
  }) as UnifiedVacancy;

describe('slice timestamps (PRB-041)', () => {
  it('stores one hh description without reading the newest time of the whole source', () => {
    // Prod 03.11: MAX(stored_at) over 664K hh rows held the HTTP event loop 1.1–1.2 s on
    // every description the matched page loaded (20 s with a cold page cache).
    const store = openStore();
    store.replaceSourceSlice('src-hh-search', [vacancy('a'), vacancy('b')]);
    const database = (store as unknown as { database: DatabaseSync }).database;
    const prepare = vi.spyOn(database, 'prepare');
    store.mergeSourceSlice('src-hh-search', [{ ...vacancy('a'), fullDescription: 'Full text' }]);
    const sql = prepare.mock.calls.map(([text]) => text);
    expect(sql.some((text) => /MAX\(stored_at\)/i.test(text))).toBe(false);
  });

  it('still drops a row the next read no longer lists, in the same millisecond', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-03T10:00:00.000Z') });
    const store = openStore();
    store.replaceSourceSlice('src-hh-search', [vacancy('a'), vacancy('b')]);
    store.mergeSourceSlice('src-hh-search', [{ ...vacancy('a'), fullDescription: 'Full text' }]);
    store.replaceSourceSlice('src-hh-search', [vacancy('a')]);
    expect(store.loadVacancies().map((item) => item.id)).toEqual(['a']);
  });
});
