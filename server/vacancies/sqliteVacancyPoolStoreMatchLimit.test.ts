import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { SEMANTIC_MATCH_CANDIDATE_LIMIT } from './vacancyPoolQuery';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SqliteVacancyPoolStore · semantic match limit (B338)', () => {
  it('reads up to SEMANTIC_MATCH_CANDIDATE_LIMIT rows for a semantic campaign', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-store-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    new SqliteVacancyPoolStore({ databasePath: path }).close();
    const limits: unknown[] = [];
    const store = new SqliteVacancyPoolStore({
      databasePath: path,
      matchReader: {
        read: (_sql, params) => {
          limits.push(params[params.length - 1]);
          return Promise.resolve([]);
        },
        close: () => undefined,
      },
    });
    stores.push(store);
    await store.queryMatchCandidatesAsync(
      {
        candidateId: 'c1',
        targetRoles: ['VP Engineering'],
        semanticRoleFunctions: ['eng-mgmt'],
        confirmedSkills: [],
        confirmedFacts: [],
      },
      { nowMs: Date.parse('2026-09-02T10:00:00.000Z') },
    );
    expect(limits).toEqual([SEMANTIC_MATCH_CANDIDATE_LIMIT]);
    expect(SEMANTIC_MATCH_CANDIDATE_LIMIT).toBeGreaterThanOrEqual(3000);
  });
});
