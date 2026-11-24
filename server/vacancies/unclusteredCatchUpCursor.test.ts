import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/** B763: курсор догона переживает рестарт обслуживания — проход не начинается заново на каждом выкате. */
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'oq-catch-up-cursor-'));
  directories.push(directory);
  return join(directory, 'pool.sqlite');
}

function vacancy(key: string): UnifiedVacancy {
  const url = `https://alpha.example/jobs/${key}`;
  return {
    id: `alpha:${key}`,
    fingerprint: `alpha:${key}`,
    title: `Backend Engineer ${key}`,
    company: `Firm ${key}Q`,
    description: 'Go',
    requiredSkills: ['Go'],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'alpha',
      externalId: key,
      sourceUrl: url,
      observedAt: '2026-11-23T00:00:00.000Z',
    },
    publishedAt: '2026-11-23T00:00:00.000Z',
    status: 'active',
  };
}

const ids = (page: { unclustered: readonly UnifiedVacancy[] }) => page.unclustered.map((v) => v.id);

describe('B763: catch-up cursor survives a restart', () => {
  it('continues from the saved rowid after a restart', () => {
    const path = databasePath();
    const first = new SqliteVacancyPoolStore({ databasePath: path });
    first.replaceSourceSlice('alpha', ['a1', 'a2', 'a3', 'a4'].map(vacancy));
    expect(ids(first.readUnclusteredPoolPage(2))).toEqual(['alpha:a1', 'alpha:a2']);
    first.close();

    const second = new SqliteVacancyPoolStore({ databasePath: path });
    expect(ids(second.readUnclusteredPoolPage(2))).toEqual(['alpha:a3', 'alpha:a4']);
    second.close();
  });

  it('wraps to the start at the end of the pool, and the wrap is saved too', () => {
    const path = databasePath();
    const first = new SqliteVacancyPoolStore({ databasePath: path });
    first.replaceSourceSlice('alpha', ['a1', 'a2'].map(vacancy));
    first.readUnclusteredPoolPage(2);
    expect(first.readUnclusteredPoolPage(2).passFinished).toBe(true);
    first.close();

    const second = new SqliteVacancyPoolStore({ databasePath: path });
    expect(ids(second.readUnclusteredPoolPage(2))).toEqual(['alpha:a1', 'alpha:a2']);
    second.close();
  });

  it('starts from the next row when the saved rowid is gone from the pool', () => {
    const path = databasePath();
    const first = new SqliteVacancyPoolStore({ databasePath: path });
    first.replaceSourceSlice('alpha', ['a1', 'a2', 'a3', 'a4'].map(vacancy));
    first.readUnclusteredPoolPage(2);
    first.replaceSourceSlice('alpha', ['a1', 'a3', 'a4'].map(vacancy));
    first.close();

    const second = new SqliteVacancyPoolStore({ databasePath: path });
    expect(ids(second.readUnclusteredPoolPage(5))).toEqual(['alpha:a3', 'alpha:a4']);
    second.close();
  });
});
