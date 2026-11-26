import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const source: VacancySourceConfig = {
  id: 'src-hh-search',
  name: 'hh.ru',
  type: 'hh_search',
  enabled: true,
  targetUrl: 'https://hh.ru/search/vacancy',
  addressStatus: 'live',
  refreshIntervalMinutes: 20,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};
const vacancy: UnifiedVacancy = {
  id: 'src-hh-search:9101',
  fingerprint: 'src-hh-search:9101',
  title: 'Инженер качества',
  company: 'Тестовая компания',
  description: 'TypeScript',
  requiredSkills: [],
  isRemote: false,
  url: 'https://hh.ru/vacancy/9101',
  provenance: {
    sourceType: 'json_api',
    sourceId: 'src-hh-search',
    sourceUrl: 'https://hh.ru/vacancy/9101',
    observedAt: '2026-11-22T10:00:00.000Z',
  },
  publishedAt: '2026-11-22T10:00:00.000Z',
  status: 'active',
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'b756-locked-'));
  const databasePath = join(dir, 'pool.db');
  const pool = new SqliteVacancyPoolStore({ databasePath });
  pool.mergeSourceSlice(source.id, [vacancy]);
  const other = new DatabaseSync(databasePath);
  cleanups.push(() => {
    other.close();
    pool.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const engine = new MultiSourceVacancyEngine({
    sources: [source],
    pool,
    descriptionLoader: { load: async () => ({ archived: true, skills: [] }) },
  });
  return { pool, other, engine };
}

describe('B756: архивная вакансия hh при занятой базе', () => {
  it('чужая транзакция держит запись — отказ на этот такт, без падения процесса; следующий такт снимает', async () => {
    const { pool, other, engine } = setup();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    cleanups.push(() => process.off('unhandledRejection', onUnhandled));

    other.exec('PRAGMA busy_timeout = 0;');
    other.exec('BEGIN IMMEDIATE');
    other.exec("UPDATE vacancy_pool SET expired_at = NULL WHERE id = 'none'");
    await expect(engine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      status: 'failed',
      unavailable: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    expect(pool.getVacancy(vacancy.id)).toBeDefined();

    other.exec('COMMIT');
    await expect(engine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      status: 'skipped',
    });
    expect(pool.getVacancy(vacancy.id)).toBeUndefined();
  }, 20_000);
});
