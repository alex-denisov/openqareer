import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { HH_SEARCH_SOURCE_ID } from './hhSearchState';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];
const readers: DatabaseSync[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const reader of readers.splice(0)) reader.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const NOW_MS = Date.parse('2026-10-29T10:00:00.000Z');

function vacancy(sourceId: string, id: string, title: string, publishedAt: string): UnifiedVacancy {
  return {
    id: `${sourceId}:${id}`,
    fingerprint: `fp-${sourceId}-${id}`,
    title,
    company: 'Synthetic Company',
    location: 'Москва',
    description: 'Synthetic description',
    requiredSkills: [],
    url: `https://hh.ru/vacancy/${id}`,
    provenance: {
      sourceType: 'hh',
      sourceId,
      sourceUrl: `https://hh.ru/vacancy/${id}`,
      observedAt: '2026-10-28T09:00:00.000Z',
    },
    publishedAt,
    status: 'active',
  } as UnifiedVacancy;
}

function openStore(): SqliteVacancyPoolStore {
  return openStoreWithPath().store;
}

/** A real file store whose out-of-process reader is replaced by a same-file read-only connection. */
function openStoreWithPath(): { store: SqliteVacancyPoolStore; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-hh-sample-'));
  directories.push(directory);
  const path = join(directory, 'pool.db');
  new SqliteVacancyPoolStore({ databasePath: path }).close();
  let reader: DatabaseSync | undefined;
  const store = new SqliteVacancyPoolStore({
    databasePath: path,
    matchReader: {
      read: (sql, params) => {
        reader ??= new DatabaseSync(path, { readOnly: true });
        if (!readers.includes(reader)) readers.push(reader);
        return Promise.resolve(reader.prepare(sql).all(...params) as { payload: string }[]);
      },
      close: () => undefined,
    },
  });
  stores.push(store);
  return { store, path };
}

/** What the maintenance worker writes for a parsed title (B267 S2). */
function classify(
  path: string,
  rows: Array<[id: string, functionCode: string, levelRank: number, publishedAt: string]>,
): void {
  const writer = new DatabaseSync(path);
  const insert = writer.prepare(
    `INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
     VALUES (?, ?, ?, ?, ?, 0)`,
  );
  for (const [id, code, level, publishedAt] of rows)
    insert.run(`${HH_SEARCH_SOURCE_ID}:${id}`, code, level, id, Date.parse(publishedAt));
  writer.close();
}

describe('SqliteVacancyPoolStore · stored hh market sample (29.10)', () => {
  it('finds Russian hh titles for an English role by its function and level', async () => {
    const { store, path } = openStoreWithPath();
    store.replaceSourceSlice(HH_SEARCH_SOURCE_ID, [
      vacancy(HH_SEARCH_SOURCE_ID, '501', 'Технический директор', '2026-10-27T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '502', 'ИТ-директор', '2026-10-26T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '503', 'Инженер-программист', '2026-10-28T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '504', 'Директор по продукту', '2026-10-28T10:00:00.000Z'),
    ]);
    classify(path, [
      ['501', 'eng-mgmt', 4, '2026-10-27T10:00:00.000Z'],
      ['502', 'eng-mgmt', 3, '2026-10-26T10:00:00.000Z'],
      ['503', 'eng-mgmt', 0, '2026-10-28T10:00:00.000Z'],
      ['504', 'product', 4, '2026-10-28T10:00:00.000Z'],
    ]);

    const found = await store.queryStoredHhSampleAsync('VP of Technology', 12, NOW_MS);

    expect(found.map((item) => item.id)).toEqual([
      `${HH_SEARCH_SOURCE_ID}:501`,
      `${HH_SEARCH_SOURCE_ID}:502`,
    ]);
  });

  it('puts exact text matches first and fills the rest by function and level', async () => {
    const { store, path } = openStoreWithPath();
    store.replaceSourceSlice(HH_SEARCH_SOURCE_ID, [
      vacancy(HH_SEARCH_SOURCE_ID, '601', 'Agile Coach', '2026-10-20T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '602', 'Руководитель проектов', '2026-10-28T10:00:00.000Z'),
    ]);
    classify(path, [
      ['601', 'project-mgmt', 1, '2026-10-20T10:00:00.000Z'],
      ['602', 'project-mgmt', 1, '2026-10-28T10:00:00.000Z'],
    ]);

    const found = await store.queryStoredHhSampleAsync('Agile coach', 12, NOW_MS);

    expect(found.map((item) => item.id)).toEqual([
      `${HH_SEARCH_SOURCE_ID}:601`,
      `${HH_SEARCH_SOURCE_ID}:602`,
    ]);
  });

  it('returns the newest stored hh records whose text holds the query', async () => {
    const store = openStore();
    store.replaceSourceSlice(HH_SEARCH_SOURCE_ID, [
      vacancy(HH_SEARCH_SOURCE_ID, '101', 'Технический директор (CTO)', '2026-10-20T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '102', 'CTO финтех-платформы', '2026-10-27T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '103', 'Управляющий кафе', '2026-10-28T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '104', 'CTO давней вакансии', '2026-06-01T10:00:00.000Z'),
    ]);
    store.replaceSourceSlice('src-indeed', [
      vacancy('src-indeed', '201', 'CTO at an Indeed employer', '2026-10-28T10:00:00.000Z'),
    ]);

    const found = await store.queryStoredHhSampleAsync('cto', 12, NOW_MS);

    expect(found.map((item) => item.id)).toEqual([
      `${HH_SEARCH_SOURCE_ID}:102`,
      `${HH_SEARCH_SOURCE_ID}:101`,
    ]);
  });

  it('caps the sample and reads nothing for a blank query', async () => {
    const store = openStore();
    store.replaceSourceSlice(HH_SEARCH_SOURCE_ID, [
      vacancy(HH_SEARCH_SOURCE_ID, '301', 'CTO 1', '2026-10-25T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '302', 'CTO 2', '2026-10-26T10:00:00.000Z'),
      vacancy(HH_SEARCH_SOURCE_ID, '303', 'CTO 3', '2026-10-27T10:00:00.000Z'),
    ]);

    expect(await store.queryStoredHhSampleAsync('cto', 2, NOW_MS)).toHaveLength(2);
    expect(await store.queryStoredHhSampleAsync('   ', 12, NOW_MS)).toEqual([]);
  });
});
