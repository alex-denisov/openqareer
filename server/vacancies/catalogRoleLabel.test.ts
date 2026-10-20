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
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-role-label-'));
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

describe('catalog role listing labels', () => {
  it('labels a role listing by a published title, not by the stored slug label (B535)', () => {
    const { store, path } = openStore();
    const titles = ['Программист 1С', 'Программист 1С', 'Программист 1С'];
    store.saveClusters(
      titles.map((title, index) => ({
        ...sampleCluster,
        id: `cluster-1c-${index}`,
        canonicalTitle: title,
      })),
    );
    // Rows projected before the fix carry the transliterated label.
    new DatabaseSync(path)
      .prepare(`UPDATE catalog_entries SET role_label = 'Programmist 1c'`)
      .run();
    const role = store.loadCatalogListings().find((listing) => listing.role);
    expect(role?.roleLabel).toBe('Программист 1С');
  });
});
