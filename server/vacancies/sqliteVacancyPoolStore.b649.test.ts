import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { MIGRATION_23 } from '../data/sqliteSchema';
import { freshnessWindow } from './vacancyPoolQuery';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openStore(): { store: SqliteVacancyPoolStore } {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-b649-'));
  directories.push(directory);
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  stores.push(store);
  return { store };
}

function card(id: string): Parameters<SqliteVacancyPoolStore['replaceSourceSlice']>[1][number] {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: 'Role',
    company: 'Company',
    description: '',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'src',
      sourceUrl: `https://example.test/${id}`,
      observedAt: '2026-09-01T10:00:00.000Z',
    },
    publishedAt: '2026-09-01T10:00:00.000Z',
    status: 'active',
  };
}

describe('SqliteVacancyPoolStore · B649', () => {
  it('queryVacancies принимает 50 000 источников одним параметром', () => {
    const { store } = openStore();
    store.replaceSourceSlice('src', [
      {
        id: 'v1',
        fingerprint: 'fp-v1',
        title: 'Role',
        company: 'Company',
        description: '',
        requiredSkills: [],
        url: 'https://example.test/v1',
        provenance: {
          sourceType: 'json_api' as const,
          sourceId: 'src',
          sourceUrl: 'https://example.test/v1',
          observedAt: '2026-09-01T10:00:00.000Z',
        },
        publishedAt: '2026-09-01T10:00:00.000Z',
        status: 'active' as const,
      },
    ]);
    const sourceIds = [...Array.from({ length: 50_000 }, (_, n) => `s${n}`), 'src'];
    const window = freshnessWindow(Date.parse('2026-09-02T10:00:00.000Z'));
    const page = store.queryVacancies({ window, sourceIds, offset: 0, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items.map((v) => v.id)).toEqual(['v1']);
  });
  it('дочитывает окнами rowid и кончает проход, даже когда дочитывать нечего (B649-2)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-b649-window-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(MIGRATION_23);
    const insert = legacy.prepare(
      'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, ?)',
    );
    const at = '2026-09-01T10:00:00.000Z';
    for (let n = 0; n < 7; n += 1)
      insert.run(`w${n}`, 'src', at, at, JSON.stringify(card(`w${n}`)));
    legacy.close();

    const store = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(store);
    expect(store.pendingBackfill()).toBe(7);
    const steps: boolean[] = [];
    for (let guard = 0; guard < 10; guard += 1) {
      const { done } = store.backfillWindowStep(3);
      steps.push(done);
      if (done) break;
    }
    expect(steps).toEqual([false, false, true]);
    expect(store.pendingBackfill()).toBe(0);
    // Второй проход по дочитанному пулу — те же три окна, без работы.
    expect(store.backfillWindowStep(3).done).toBe(false);
    expect(store.backfillWindowStep(3).done).toBe(false);
    expect(store.backfillWindowStep(3).done).toBe(true);
  });
});
