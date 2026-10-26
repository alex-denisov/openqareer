import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import type { VacancyCluster } from '../domain/unifiedVacancy';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function openStore(): SqliteVacancyPoolStore {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-company-'));
  directories.push(directory);
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  stores.push(store);
  return store;
}

function cluster(id: string, company: string, title: string, status = 'active'): VacancyCluster {
  return {
    id,
    canonicalTitle: title,
    canonicalCompany: company,
    canonicalLocation: 'Remote, US',
    isRemote: true,
    descriptionSummary: 'Role',
    salary: { from: 1, to: 2, currency: 'USD' },
    skills: [],
    primaryUrl: `https://example.test/${id}`,
    sources: [
      {
        sourceType: 'json_api',
        sourceId: 'indeed',
        sourceUrl: `https://example.test/${id}`,
        observedAt: '2026-10-19T10:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-10-19T10:00:00.000Z',
    lastSeenAt: '2026-10-20T10:00:00.000Z',
    status,
    vacanciesCount: 1,
  } as VacancyCluster;
}

describe('SqliteVacancyPoolStore · clusters of one company (company screen)', () => {
  it('finds the company clusters whatever the legal suffix, and nothing of a look-alike', () => {
    const store = openStore();
    store.saveClusters([
      cluster('a1', 'Autodesk, Inc.', 'Senior Director, Engineering'),
      cluster('a2', 'Autodesk', 'Director of Engineering'),
      cluster('x1', 'Autodesk Partners Group', 'Head of Sales'),
      cluster('y1', 'Atlassian', 'VP Engineering'),
      cluster('a3', 'Autodesk', 'Closed role', 'archived'),
    ]);

    const found = store.loadClustersByCompany('Autodesk', 10);

    expect(found.map((item) => item.id).sort()).toEqual(['a1', 'a2']);
  });

  it('caps the result and returns nothing for an empty name', () => {
    const store = openStore();
    store.saveClusters([
      cluster('a1', 'Autodesk', 'Role 1'),
      cluster('a2', 'Autodesk', 'Role 2'),
      cluster('a3', 'Autodesk', 'Role 3'),
    ]);

    expect(store.loadClustersByCompany('Autodesk', 2)).toHaveLength(2);
    expect(store.loadClustersByCompany('  ', 5)).toEqual([]);
  });
});
