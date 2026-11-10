import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import type { VacancyCluster } from '../domain/unifiedVacancy';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openStore(): { store: SqliteVacancyPoolStore; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-listings-stored-'));
  directories.push(directory);
  const path = join(directory, 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  stores.push(store);
  return { store, path };
}

const sampleCluster: VacancyCluster = {
  id: 'cluster-v1',
  canonicalTitle: 'Senior TypeScript Developer',
  canonicalCompany: 'Tech Corp',
  canonicalLocation: 'Berlin',
  isRemote: true,
  salary: { from: 80000, to: 100000, currency: 'EUR' },
  descriptionSummary: 'Great role',
  skills: ['TypeScript', 'Node.js'],
  primaryUrl: 'https://example.test/v1',
  sources: [
    {
      sourceType: 'json_api',
      sourceId: 'src1',
      sourceUrl: 'https://example.test/v1',
      observedAt: '2026-09-01T10:00:00.000Z',
    },
  ],
  firstObservedAt: '2026-09-01T10:00:00.000Z',
  lastSeenAt: '2026-09-02T10:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};

const listingClusters = (titles: readonly string[]) =>
  titles.map((title, index) => ({
    ...sampleCluster,
    id: `cluster-listing-${index}`,
    canonicalTitle: title,
  }));

describe('stored catalog listings (PRB-041)', () => {
  it('serves the listings maintenance wrote, without the GROUP BY over the projection', () => {
    // Prod 03.11: the GROUP BY over 3 004 listings held the event loop 0.75–1.1 s every 5 min.
    const { store, path } = openStore();
    store.saveClusters(listingClusters(['Бухгалтер', 'Бухгалтер', 'Бухгалтер']));
    store.recomputeCatalogTotals('2026-11-03T10:00:00.000Z');
    const written = store.loadCatalogListings();
    expect(written.find((listing) => listing.role === 'accountant')?.count).toBe(3);

    new DatabaseSync(path).prepare('DELETE FROM catalog_entries').run();
    expect(store.loadCatalogListings()).toEqual(written);
  });

  it('counts live until maintenance has written them, and rewrites them on the next pass', () => {
    const { store, path } = openStore();
    store.saveClusters(listingClusters(['Бухгалтер', 'Бухгалтер', 'Бухгалтер']));
    expect(
      store.loadCatalogListings().find((listing) => listing.role === 'accountant')?.count,
    ).toBe(3);

    store.recomputeCatalogTotals('2026-11-03T10:00:00.000Z');
    new DatabaseSync(path).prepare('DELETE FROM catalog_entries').run();
    store.recomputeCatalogTotals('2026-11-03T10:15:00.000Z');
    expect(store.loadCatalogListings()).toEqual([]);
  });

  it('counts active clusters in slices and gives the queue back between them', async () => {
    // Prod 08.11: one json_extract pass over 463 000 clusters held the queue 42 s.
    const { store } = openStore();
    store.saveClusters([
      ...listingClusters(['Бухгалтер', 'Бухгалтер', 'Бухгалтер', 'Юрист']),
      { ...sampleCluster, id: 'cluster-closed', status: 'archived' as const },
    ]);
    let pauses = 0;
    const totals = await store.recomputeCatalogTotalsInSlices('2026-11-09T10:00:00.000Z', {
      sliceRows: 2,
      pause: async () => {
        pauses += 1;
      },
    });
    expect(totals.clusters).toBe(4);
    expect(pauses).toBe(2);
    expect(store.readCatalogTotals()?.clusters).toBe(4);
    expect(
      store.loadCatalogListings().find((listing) => listing.role === 'accountant')?.count,
    ).toBe(3);
  });

  it('reads totals and listings in a worker thread on a file database (B641)', async () => {
    const { store } = openStore();
    store.saveClusters([
      ...listingClusters(['Бухгалтер', 'Бухгалтер', 'Бухгалтер', 'Юрист']),
      { ...sampleCluster, id: 'cluster-closed', status: 'archived' as const },
    ]);
    const totals = await store.recomputeCatalogTotalsInSlices('2026-11-10T10:00:00.000Z');
    expect(totals.clusters).toBe(4);
    expect(store.readCatalogTotals()?.clusters).toBe(4);
    expect(
      store.loadCatalogListings().find((listing) => listing.role === 'accountant')?.count,
    ).toBe(3);
  });
});
