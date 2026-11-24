import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { WorkdayDescriptionBackfill } from './workdayDescriptions';

const SONY = 'ats-workday-sonyglobal';
const NVIDIA = 'ats-workday-nvidia';
const SONY_URL = 'https://sonyglobal.wd1.myworkdayjobs.com/SonyGlobalCareers/job/London/Role_JR-1';
const NVIDIA_URL =
  'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/Engineer_JR1';

function workday(id: string, sourceId: string, url: string): UnifiedVacancy {
  return {
    id,
    fingerprint: id,
    title: 'Role',
    company: 'Company',
    description: '',
    requiredSkills: [],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: url,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'b756-workday-locked-'));
  const databasePath = join(dir, 'pool.db');
  const pool = new SqliteVacancyPoolStore({ databasePath });
  const sony = workday(`${SONY}:JR-1`, SONY, SONY_URL);
  pool.mergeSourceSlice(SONY, [sony]);
  pool.mergeSourceSlice(NVIDIA, [workday(`${NVIDIA}:JR1`, NVIDIA, NVIDIA_URL)]);
  const other = new DatabaseSync(databasePath);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  cleanups.push(() => {
    process.off('unhandledRejection', onUnhandled);
    other.close();
    pool.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const backfill = new WorkdayDescriptionBackfill({
    pool,
    sourceIds: () => [SONY, NVIDIA],
    // Вторая площадка не пишет: важен только порядок — первая падает, пока цикл ещё идёт.
    fetchDetail: async (url) =>
      url.includes('sonyglobal')
        ? { status: 200, payload: { jobPostingInfo: { jobDescription: '<p>Python and SQL.</p>' } } }
        : { status: 500 },
    sleep: async () => undefined,
    maxAttempts: 1,
  });
  return { pool, other, backfill, sony, unhandled };
}

describe('B756: дочитывание Workday при занятой базе', () => {
  it('чужая транзакция держит запись — такт завершается без падения, попытка не сгорает, следующий такт пишет', async () => {
    const { pool, other, backfill, sony, unhandled } = setup();
    other.exec('BEGIN IMMEDIATE');
    other.exec("UPDATE vacancy_pool SET expired_at = NULL WHERE id = 'none'");

    const report = await backfill.step();
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    expect(report).toMatchObject({ requested: 2, loaded: 0 });
    expect(pool.getVacancy(sony.id)?.fullDescription).toBeUndefined();

    other.exec('COMMIT');
    const next = await backfill.step();
    expect(next).toMatchObject({ loaded: 1 });
    expect(pool.getVacancy(sony.id)?.fullDescription).toContain('Python and SQL');
  }, 30_000);
});
