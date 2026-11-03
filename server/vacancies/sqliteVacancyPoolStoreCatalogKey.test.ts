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

function cluster(id: string): VacancyCluster {
  return {
    id,
    canonicalTitle: 'Senior Backend Engineer',
    canonicalCompany: 'Acme',
    canonicalLocation: 'Remote, US',
    isRemote: true,
    descriptionSummary: 'Role',
    salary: { from: 1, to: 2, currency: 'USD' },
    skills: [],
    primaryUrl: 'https://example.test/same',
    sources: [
      {
        sourceType: 'json_api',
        sourceId: 'indeed',
        sourceUrl: 'https://example.test/same',
        observedAt: '2026-10-19T10:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-10-19T10:00:00.000Z',
    lastSeenAt: '2026-10-20T10:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  } as VacancyCluster;
}

describe('catalog entry key is idempotent', () => {
  it('two clusters whose 32-bit vacancyKey collides do not fail the write', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-key-'));
    directories.push(directory);
    const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
    stores.push(store);
    expect(() => store.saveClusters([cluster('c-308475')])).not.toThrow();
    expect(() => store.saveClusters([cluster('c-1293310')])).not.toThrow();
    expect(() => store.saveClusters([cluster('c-1293310')])).not.toThrow();
  });
});
