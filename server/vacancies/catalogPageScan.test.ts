import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

const cluster = (index: number): VacancyCluster => ({
  id: `cluster-${index}`,
  canonicalTitle: 'Бухгалтер',
  canonicalCompany: 'Tech Corp',
  canonicalLocation: 'Berlin',
  isRemote: false,
  descriptionSummary: 'Описание',
  skills: [],
  primaryUrl: `https://example.test/${index}`,
  sources: [
    {
      sourceType: 'json_api',
      sourceId: 'src1',
      sourceUrl: `https://example.test/${index}`,
      observedAt: '2026-09-01T10:00:00.000Z',
    },
  ],
  // Pairs share a published time: the cursor has to break the tie by key.
  firstObservedAt: `2026-09-0${1 + Math.floor(index / 2)}T10:00:00.000Z`,
  lastSeenAt: '2026-09-09T10:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
});

const COUNT = 7;

function open() {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-page-scan-'));
  directories.push(directory);
  const path = join(directory, 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  stores.push(store);
  store.saveClusters(Array.from({ length: COUNT }, (_, index) => cluster(index)));
  return { store, path, engine: new MultiSourceVacancyEngine({ sources: [], pool: store }) };
}

function preparedDuring(run: () => void): string[] {
  const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  run();
  const statements = prepare.mock.calls.map(([sql]) => sql);
  prepare.mockRestore();
  return statements;
}

const isEntryCount = (sql: string) => /count\(\*\)[\s\S]*catalog_entries\b/u.test(sql);

describe('catalog page reads (B776)', () => {
  it('serves the whole-catalog total maintenance wrote, without a scan in the request', async () => {
    const { store, engine } = open();
    await store.recomputeCatalogTotalsInSlices('2026-11-24T10:00:00.000Z');
    let total: number | undefined;
    const statements = preparedDuring(() => {
      total = engine.getPublicCatalogEntriesPage({ limit: 2 })?.total;
    });
    expect(total).toBe(COUNT);
    expect(statements.filter(isEntryCount)).toEqual([]);
  });

  it('counts live until maintenance has written the total, and follows its next pass', () => {
    const { store, path, engine } = open();
    expect(engine.getPublicCatalogEntriesPage({ limit: 2 })?.total).toBe(COUNT);
    const writer = new DatabaseSync(path);
    writer.exec("DELETE FROM catalog_entries WHERE cluster_id = 'cluster-0'");
    writer.close();
    store.recomputeCatalogTotals('2026-11-24T10:15:00.000Z');
    expect(store.readCatalogEntriesTotal()).toBe(COUNT - 1);
    const restarted = new MultiSourceVacancyEngine({ sources: [], pool: store });
    expect(restarted.getPublicCatalogEntriesPage({ limit: 2 })?.total).toBe(COUNT - 1);
  });

  it.each([{}, { place: 'berlin' }, { place: 'berlin', role: 'accountant' }])(
    'seeks to the cursor by published time instead of walking every newer row: %o',
    (group) => {
      const { store, path } = open();
      const first = store.loadCatalogEntriesPage({ ...group, limit: 2, knownTotal: COUNT });
      const [sql] = preparedDuring(() => {
        store.loadCatalogEntriesPage({
          ...group,
          limit: 2,
          knownTotal: COUNT,
          after: first.nextCursor!,
        });
      });
      const database = new DatabaseSync(path);
      const plan = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
      database.close();
      expect(plan.map((row) => row.detail).join()).toContain('published_ms<?');
    },
  );

  it('visits every entry once across cursor pages, ties included', () => {
    const { store } = open();
    const seen: string[] = [];
    let after: { publishedMs: number; key: string } | undefined;
    do {
      const page = store.loadCatalogEntriesPage({ limit: 1, ...(after ? { after } : {}) });
      seen.push(...page.items.map((item) => item.clusterId));
      after = page.nextCursor;
    } while (after);
    const whole = store.loadCatalogEntriesPage({ limit: 50 }).items.map((item) => item.clusterId);
    expect(seen).toEqual(whole);
    expect(new Set(seen).size).toBe(COUNT);
  });
});
