import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { HhCatalogTextBackfill, type HhCatalogTextEngine } from './hhCatalogText';

const HH = 'src-hh-search';
const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openSqlite(): SqliteVacancyPoolStore {
  const directory = mkdtempSync(join(tmpdir(), 'hh-catalog-text-'));
  directories.push(directory);
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  stores.push(store);
  return store;
}

function hh(n: number, daysAgo: number, fullDescription?: string): UnifiedVacancy {
  const id = `${HH}:${n}`;
  const url = `https://hh.ru/vacancy/${n}`;
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    id,
    fingerprint: id,
    title: `Аналитик ${n}`,
    company: 'Компания',
    location: 'Москва',
    description: '',
    ...(fullDescription ? { fullDescription } : {}),
    requiredSkills: [],
    url,
    provenance: { sourceType: 'hh_search', sourceId: HH, sourceUrl: url, observedAt: at },
    publishedAt: at,
    status: 'active',
  };
}

function clusterOf(vacancy: UnifiedVacancy): VacancyCluster {
  return {
    id: `cluster-${vacancy.id}`,
    canonicalTitle: 'Senior Data Analyst',
    canonicalCompany: vacancy.company,
    canonicalLocation: 'Moscow',
    isRemote: false,
    salary: { from: 200000, to: 300000, currency: 'RUR' },
    descriptionSummary: '',
    skills: [],
    primaryUrl: vacancy.url,
    sources: [vacancy.provenance],
    firstObservedAt: vacancy.publishedAt,
    lastSeenAt: new Date().toISOString(),
    status: 'active',
    vacanciesCount: 1,
  };
}

describe('SqliteVacancyPoolStore.loadHhTextCandidates', () => {
  it('walks catalog cards newest first, then the rest of the pool, skipping loaded text', () => {
    const store = openSqlite();
    const inCatalogOld = hh(1, 5);
    const inCatalogNew = hh(2, 1);
    const inCatalogLoaded = hh(3, 0, 'Полный текст');
    const poolOnlyNew = hh(4, 0);
    const poolOnlyOld = hh(5, 9);
    store.mergeSourceSlice(HH, [
      inCatalogOld,
      inCatalogNew,
      inCatalogLoaded,
      poolOnlyNew,
      poolOnlyOld,
    ]);
    store.saveClusters([inCatalogOld, inCatalogNew, inCatalogLoaded].map(clusterOf));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const batch = store.loadHhTextCandidates(cursor, 1);
      seen.push(...batch.ids);
      cursor = batch.cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([inCatalogNew.id, inCatalogOld.id, poolOnlyNew.id, poolOnlyOld.id]);
    expect(cursor).toBeUndefined();
  });

  it('leaves out expired records', () => {
    const store = openSqlite();
    const live = hh(1, 1);
    const gone = hh(2, 0);
    store.mergeSourceSlice(HH, [live, gone]);
    store.saveClusters([live, gone].map(clusterOf));
    store.markExpired([gone.id], new Date().toISOString());
    expect(store.loadHhTextCandidates(undefined, 10).ids).toEqual([live.id]);
  });
});

describe('MemoryVacancyPoolStore.loadHhTextCandidates', () => {
  it('returns live hh records without text, newest first', () => {
    const store = new MemoryVacancyPoolStore();
    store.mergeSourceSlice(HH, [hh(1, 3), hh(2, 0, 'text'), hh(3, 1)]);
    const first = store.loadHhTextCandidates(undefined, 1);
    expect(first.ids).toEqual([`${HH}:3`]);
    const second = store.loadHhTextCandidates(first.cursor, 5);
    expect(second.ids).toEqual([`${HH}:1`]);
    expect(second.cursor).toBeUndefined();
  });
});

describe('HhCatalogTextBackfill', () => {
  function engineWith(
    pages: Array<{ ids: string[]; cursor?: string }>,
    statuses: Record<string, 'loaded' | 'cached' | 'skipped' | 'failed'>,
    unavailable: string[] = [],
  ) {
    const loaded: string[] = [];
    const cursors: Array<string | undefined> = [];
    const engine: HhCatalogTextEngine = {
      hhTextReady: () => true,
      loadHhTextCandidates: (cursor) => {
        cursors.push(cursor);
        return pages.shift() ?? { ids: [] };
      },
      loadVacancyDescription: async (id) => {
        loaded.push(id);
        const status = statuses[id] ?? 'loaded';
        // Отказ — один раз: повтор той же записи следующим тиком проходит.
        delete statuses[id];
        return { unavailable: unavailable.includes(id), status };
      },
    };
    return { engine, loaded, cursors };
  }

  it('loads a page of candidates one by one and keeps the cursor between ticks', async () => {
    const { engine, loaded, cursors } = engineWith(
      [{ ids: ['a', 'b'], cursor: 'c1' }, { ids: ['c'] }],
      { b: 'skipped' },
      ['b'],
    );
    const backfill = new HhCatalogTextBackfill({ engine, perTick: 5 });
    expect(await backfill.step()).toEqual({ requested: 2, loaded: 1, retired: 1, failed: 0 });
    expect(await backfill.step()).toMatchObject({ requested: 1, loaded: 1 });
    expect(loaded).toEqual(['a', 'b', 'c']);
    expect(cursors).toEqual([undefined, 'c1']);
  });

  it('stops the tick at the first failure and retries that record next tick', async () => {
    const { engine, loaded, cursors } = engineWith(
      [
        { ids: ['a', 'b'], cursor: 'c1' },
        { ids: ['a', 'b'], cursor: 'c1' },
      ],
      { a: 'failed' },
    );
    const backfill = new HhCatalogTextBackfill({ engine, perTick: 5 });
    expect(await backfill.step()).toMatchObject({ requested: 1, failed: 1 });
    await backfill.step();
    expect(loaded).toEqual(['a', 'a', 'b']);
    expect(cursors).toEqual([undefined, undefined]);
  });

  it('does nothing when hh is not live or has no loader', async () => {
    const { engine, loaded } = engineWith([{ ids: ['a'] }], {});
    const backfill = new HhCatalogTextBackfill({
      engine: { ...engine, hhTextReady: () => false },
    });
    expect(await backfill.step()).toEqual({ requested: 0, loaded: 0, retired: 0, failed: 0 });
    expect(loaded).toEqual([]);
  });
});

describe('MultiSourceVacancyEngine.runHhCatalogTextStep', () => {
  it('reads catalog cards through the hh loader and stores their text', async () => {
    const { MultiSourceVacancyEngine } = await import('./multiSourceVacancyEngine');
    const { HhVacancyDescriptionLoader } = await import('./hhVacancyDescription');
    const { DEFAULT_VACANCY_SOURCES } = await import('./defaultVacancySources');
    const hhSource = DEFAULT_VACANCY_SOURCES.find((s) => s.id === HH)!;
    const requested: string[] = [];
    const pool = openSqlite();
    const engine = new MultiSourceVacancyEngine({
      sources: [hhSource],
      pool,
      descriptionLoader: new HhVacancyDescriptionLoader({
        transport: async (url) => {
          requested.push(url);
          return {
            status: 200,
            body: '<div data-qa="vacancy-description"><p>Строим аналитику на Python и SQL.</p></div>',
          };
        },
        sleep: async () => undefined,
      }),
      recluster: { mode: 'off' },
    });
    const card = hh(7, 1);
    pool.mergeSourceSlice(HH, [card]);
    pool.saveClusters([clusterOf(card)]);

    expect(await engine.runHhCatalogTextStep()).toMatchObject({ requested: 1, loaded: 1 });
    expect(requested).toEqual([card.url]);
    expect(pool.getVacancy(card.id)?.fullDescription).toContain('Python');
    expect(await engine.runHhCatalogTextStep()).toMatchObject({ requested: 0 });
  });
});
