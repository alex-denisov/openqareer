import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { withWorkdayText } from './workdayDescriptions';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openSqlite(): SqliteVacancyPoolStore {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-workday-'));
  directories.push(directory);
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  stores.push(store);
  return store;
}

const SOURCE = 'ats-workday-sonyglobal';

function workday(n: number): UnifiedVacancy {
  const url = `https://sonyglobal.wd1.myworkdayjobs.com/SonyGlobalCareers/job/London/Role_JR-${n}`;
  return {
    id: `${SOURCE}:JR-${n}`,
    fingerprint: `${SOURCE}:JR-${n}`,
    title: `Role ${n}`,
    company: 'Sony',
    description: '',
    requiredSkills: [],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId: SOURCE,
      sourceUrl: url,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

describe.each([
  ['sqlite', () => openSqlite()],
  ['memory', () => new MemoryVacancyPoolStore()],
] as const)('Workday text in the %s pool (B535)', (_name, open) => {
  it('lists records without text newest first, skipping excluded and expired ones', () => {
    const store = open();
    store.mergeSourceSlice(SOURCE, [workday(1), workday(2), workday(3), workday(4)]);
    store.mergeSourceSlice(SOURCE, [withWorkdayText(workday(2), 'Loaded text about Python.')]);
    store.markExpired([workday(4).id], new Date().toISOString());

    const ids = store.loadVacanciesWithoutFullText(SOURCE, 5, [workday(3).id]).map((v) => v.id);
    expect(ids).toEqual([workday(1).id]);
    expect(store.loadVacanciesWithoutFullText(SOURCE, 5, []).map((v) => v.id)).toEqual([
      workday(3).id,
      workday(1).id,
    ]);
    expect(store.loadVacanciesWithoutFullText(SOURCE, 1, [])).toHaveLength(1);
    expect(store.loadVacanciesWithoutFullText('ats-workday-other', 5, [])).toEqual([]);
  });

  it('keeps loaded text when the list sync writes the record again', () => {
    const store = open();
    store.mergeSourceSlice(SOURCE, [withWorkdayText(workday(1), 'Loaded text about Python.')]);
    store.mergeSourceSlice(SOURCE, [{ ...workday(1), title: 'Renamed' }]);

    const saved = store.getVacancy(workday(1).id);
    expect(saved?.title).toBe('Renamed');
    expect(saved?.fullDescription).toBe('Loaded text about Python.');
    expect(saved?.requiredSkills).toContain('Python');
  });

  it.each(['ats-smartrecruiters-BoschGroup', 'src-netflix', 'src-habr-career'])(
    'keeps loaded %s text when the list writes the record again with its stand-in',
    (sourceId) => {
      const store = open();
      const record = { ...workday(9), id: `${sourceId}:9`, fingerprint: `${sourceId}:9` };
      store.mergeSourceSlice(sourceId, [withWorkdayText(record, 'Loaded text about Python.')]);
      store.mergeSourceSlice(sourceId, [{ ...record, description: 'Role 9 — Team' }]);
      expect(store.getVacancy(record.id)?.fullDescription).toBe('Loaded text about Python.');
      expect(store.getVacancy(record.id)?.description).toBe('Loaded text about Python.');
    },
  );

  it('drops an old "title — city" stand-in on the next sync', () => {
    const store = open();
    store.mergeSourceSlice(SOURCE, [{ ...workday(1), description: 'Role 1 — London' }]);
    store.mergeSourceSlice(SOURCE, [workday(1)]);
    expect(store.getVacancy(workday(1).id)?.description).toBe('');
  });
});
