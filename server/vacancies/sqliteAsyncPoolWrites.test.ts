import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  directories.splice(0);
});

function card(id: string) {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: 'Role',
    company: 'Company',
    description: '',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api' as const,
      sourceId: 'src',
      sourceUrl: `https://example.test/${id}`,
      observedAt: '2026-09-01T10:00:00.000Z',
    },
    publishedAt: '2026-09-01T10:00:00.000Z',
    status: 'active' as const,
  };
}

describe('SQLite async pool writes (B230)', () => {
  it('yields between chunks so shutdown can observe a large source read', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-async-'));
    directories.push(directory);
    const store = new SqliteVacancyPoolStore({
      databasePath: join(directory, 'pool.db'),
      writeChunkSize: 1,
    });
    stores.push(store);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });

    await store.replaceSourceSliceAsync?.('src', ['a', 'b', 'c'].map(card));

    expect(yielded).toBe(true);
    expect(
      store
        .loadVacancies()
        .map((vacancy) => vacancy.id)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });
});
