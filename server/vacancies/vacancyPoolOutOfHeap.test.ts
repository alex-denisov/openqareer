import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATION_23 } from '../data/sqliteSchema';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B221 — движок не держит копию пула в куче. Доказательство: то, что попало в
 * хранилище мимо движка, движок видит сразу, без `restore` и без опроса.
 */

const SOURCE: VacancySourceConfig = {
  id: 'board',
  name: 'Board',
  type: 'json_api',
  enabled: true,
  targetUrl: 'https://example.test/jobs',
  refreshIntervalMinutes: 60,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

function vacancy(id: string, publishedAt = new Date().toISOString()): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `Role ${id}`,
    company: 'Acme',
    description: '',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: SOURCE.id,
      sourceUrl: `https://example.test/${id}`,
      observedAt: publishedAt,
    },
    publishedAt,
    status: 'active',
  };
}

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('B221 · пул читается из хранилища, а не из кучи', () => {
  it('видит записи, попавшие в хранилище мимо движка, без restore', () => {
    const pool = new MemoryVacancyPoolStore();
    const engine = new MultiSourceVacancyEngine({ sources: [SOURCE], pool });
    expect(engine.poolSize).toBe(0);

    // Разные работодатели: одинаковые слились бы в один кластер.
    pool.replaceSourceSlice(SOURCE.id, [vacancy('a'), { ...vacancy('b'), company: 'Globex' }]);

    expect(engine.poolSize).toBe(2);
    expect(engine.getVacancy('a')?.title).toBe('Role a');
    expect(engine.getVacancies().total).toBe(2);
    expect(engine.getVacancies().statsBySource).toEqual([
      { sourceId: SOURCE.id, sourceName: SOURCE.name, count: 2 },
    ]);
    // Кластеры — единственное, что живёт в куче. Их сборку запускает опрос или
    // restore, а не чужая запись в хранилище; но собираются они из хранилища.
    engine.recluster();
    expect(
      engine
        .getActiveClusters()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['cluster-a', 'cluster-b']);
  });

  it('переводит фильтр по типу площадки в список площадок и уважает сочетание с sourceId', () => {
    const pool = new MemoryVacancyPoolStore();
    const other: VacancySourceConfig = {
      ...SOURCE,
      id: 'channel',
      name: 'Channel',
      type: 'telegram',
    };
    const engine = new MultiSourceVacancyEngine({ sources: [SOURCE, other], pool });
    pool.replaceSourceSlice(SOURCE.id, [vacancy('a')]);
    pool.replaceSourceSlice(other.id, [
      {
        ...vacancy('c'),
        provenance: { ...vacancy('c').provenance, sourceId: other.id, sourceType: 'telegram' },
      },
    ]);

    expect(engine.getVacancies({ type: 'telegram' }).items.map((v) => v.id)).toEqual(['c']);
    expect(engine.getVacancies({ type: 'telegram', sourceId: SOURCE.id }).total).toBe(0);
    expect(engine.getVacancies({ type: 'rss' }).total).toBe(0);
  });

  it('restoreAsync дочитывает базу, записанную до B221, и считает пул по ней', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pool-out-of-heap-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(MIGRATION_23);
    const insert = legacy.prepare(
      'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    for (const id of ['a', 'b', 'c']) {
      insert.run(id, SOURCE.id, now, now, JSON.stringify(vacancy(id, now)));
    }
    legacy.close();

    const pool = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(pool);
    const engine = new MultiSourceVacancyEngine({ sources: [SOURCE], pool });
    expect(await engine.restoreAsync(Date.now(), 2)).toEqual({ restored: 3 });
    expect(pool.pendingBackfill()).toBe(0);
    expect(engine.getVacancies({ query: 'role b' }).items.map((v) => v.id)).toEqual(['b']);
  });
});
