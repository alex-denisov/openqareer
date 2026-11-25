import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const LI = 'src-linkedin-guest';
const PAGE =
  '<div class="show-more-less-html__markup relative"><p>Own the Python platform.</p></div>' +
  '<button class="show-more-less-html__button show-more-less-button">Show more</button>';
const cleanups: (() => void)[] = [];

afterEach(() => cleanups.splice(0).forEach((run) => run()));

function openSqlite(): SqliteVacancyPoolStore {
  const directory = mkdtempSync(join(tmpdir(), 'detail-text-'));
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

function listed(n: number, fullDescription?: string): UnifiedVacancy {
  const id = `${LI}:${n}`;
  const url = `https://www.linkedin.com/jobs/view/${n}`;
  const at = new Date().toISOString();
  return {
    id,
    fingerprint: id,
    title: `CTO ${n}`,
    company: 'Acme',
    location: 'Berlin',
    description: `CTO ${n} — Acme — Berlin`,
    ...(fullDescription ? { fullDescription } : {}),
    requiredSkills: [],
    url,
    provenance: { sourceType: 'hh_search', sourceId: LI, sourceUrl: url, observedAt: at },
    publishedAt: at,
    status: 'active',
  };
}

describe.each([
  ['sqlite', openSqlite],
  ['memory', () => new MemoryVacancyPoolStore()],
] as const)('B791: priority of listed vacancies without text — %s', (_, open) => {
  it('best rank wins; read, expired, foreign and exhausted rows are not returned', () => {
    const store = open();
    store.mergeSourceSlice(LI, [listed(1), listed(2), listed(3, 'Текст'), listed(4)]);
    store.requestDetailTextPriority([`${LI}:2`, `${LI}:1`, `${LI}:3`, 'src-remotive:9'], 10);
    store.requestDetailTextPriority([`${LI}:4`, `${LI}:1`], 0);
    store.markExpired([`${LI}:4`], new Date().toISOString());
    expect(store.peekDetailTextPriority(LI, 10)).toEqual([`${LI}:1`, `${LI}:2`]);
    expect(store.peekDetailTextPriority(LI, 1, [`${LI}:1`])).toEqual([`${LI}:2`]);
    expect(store.peekDetailTextPriority('src-netflix', 10)).toEqual([]);
  });

  it('the worker reads the requested row before newer ones, one per step, then the rest', async () => {
    const pool = open();
    pool.mergeSourceSlice(LI, [listed(1), listed(2), listed(3)]);
    const asked: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      pool,
      sources: DEFAULT_VACANCY_SOURCES.filter((source) => source.id === LI),
      workdayDetailFetch: async (url) => {
        asked.push(url.split('/').at(-1)!);
        return { status: 200, payload: PAGE };
      },
    });
    engine.requestHhTextPriority([`${LI}:1`]);
    await engine.runWorkdayDescriptionStep();
    expect(asked).toEqual(['1']);
    await engine.runWorkdayDescriptionStep();
    expect(asked).toEqual(['1']);
    expect(engine.getVacancy(`${LI}:1`)?.fullDescription).toContain('Python');
    expect(pool.peekDetailTextPriority(LI, 10)).toEqual([]);
  });
});
