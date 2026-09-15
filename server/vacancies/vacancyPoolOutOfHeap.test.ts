import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('B221 · фоновое сведение', () => {
  function engineWith(minIntervalMs: number, reading: () => UnifiedVacancy[]) {
    return new MultiSourceVacancyEngine({
      sources: [SOURCE],
      fetcher: async () => reading(),
      recluster: { mode: 'background', minIntervalMs },
    });
  }

  it('чтение не ждёт сборки, а сборка идёт в фоне один раз', async () => {
    const engine = engineWith(0, () => [vacancy('a'), { ...vacancy('b'), company: 'Globex' }]);
    await engine.syncAll();
    // Волна не сводит сама: сборка идёт отдельной фоновой задачей.
    await engine.backgroundRecluster;
    expect(engine.getActiveClusters()).toHaveLength(2);
    expect(engine.clusterRebuildCount).toBe(1);
  });

  it('волна раньше срока не запускает вторую сборку сразу, а откладывает её', async () => {
    vi.useFakeTimers();
    try {
      const reading = { items: [vacancy('a')] };
      const engine = engineWith(60_000, () => reading.items);
      await engine.syncAll();
      await engine.backgroundRecluster;
      expect(engine.clusterRebuildCount).toBe(1);

      reading.items = [vacancy('a'), { ...vacancy('b'), company: 'Globex' }];
      await engine.syncAll();
      expect(engine.backgroundRecluster).toBeUndefined();
      expect(engine.getActiveClusters()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(60_000);
      await engine.backgroundRecluster;
      expect(engine.clusterRebuildCount).toBe(2);
      expect(engine.getActiveClusters()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('B221 · чистый запуск без кучи и предсуществующие кластеры (срез 4)', () => {
  it('старт с предсуществующими кластерами в SQLite мгновенен и восстанавливает их без повторного сведения', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pool-startup-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');

    // 1. Создаем начальную базу с вакансиями и кластерами
    const initialPool = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(initialPool);
    const initialEngine = new MultiSourceVacancyEngine({ sources: [SOURCE], pool: initialPool });
    initialPool.replaceSourceSlice(SOURCE.id, [
      vacancy('v1'),
      { ...vacancy('v2'), company: 'Globex' },
    ]);
    initialEngine.recluster();
    expect(initialPool.countClusters()).toBe(2);
    initialPool.close();

    // 2. Симулируем перезапуск сервера (новый процесс с чистой кучей)
    const restartedPool = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(restartedPool);
    const restartedEngine = new MultiSourceVacancyEngine({ sources: [SOURCE], pool: restartedPool });

    const iterateSpy = vi.spyOn(restartedPool, 'iterateClusterInput');
    const reclusterSpy = vi.spyOn(restartedEngine, 'reclusterAsync');

    // Процедура старта сервера (как в server/index.ts)
    const startedAt = Date.now();
    const restored = await restartedEngine.restoreAsync();
    if (restartedEngine.getActiveClusters().length === 0 && restartedEngine.poolSize > 0) {
      await restartedEngine.reclusterAsync();
    }
    const elapsedMs = Date.now() - startedAt;

    expect(restored.restored).toBe(2);
    expect(restartedEngine.getActiveClusters()).toHaveLength(2);
    expect(restartedEngine.clusterRebuildCount).toBe(0);
    expect(reclusterSpy).not.toHaveBeenCalled();
    expect(iterateSpy).not.toHaveBeenCalled();
    expect(elapsedMs).toBeLessThan(500);
  });

  it('старт без сохранённых кластеров при наличии вакансий запускает первичное сведение и сохраняет их', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pool-startup-empty-clusters-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');

    // 1. Заполняем вакансии напрямую в базу без создания кластеров
    const pool = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(pool);
    pool.replaceSourceSlice(SOURCE.id, [
      vacancy('v1'),
      { ...vacancy('v2'), company: 'Globex' },
    ]);
    expect(pool.countClusters()).toBe(0);

    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool,
      recluster: { mode: 'background', minIntervalMs: 60_000 },
    });
    const reclusterSpy = vi.spyOn(engine, 'reclusterAsync');
    const iterateSpy = vi.spyOn(pool, 'iterateClusterInput');

    // Процедура старта сервера (как в server/index.ts)
    const restored = await engine.restoreAsync();
    if (engine.getActiveClusters().length === 0 && engine.poolSize > 0) {
      await engine.reclusterAsync();
    }

    expect(restored.restored).toBe(2);
    expect(reclusterSpy).toHaveBeenCalledTimes(1);
    expect(iterateSpy).toHaveBeenCalledTimes(1);
    expect(engine.getActiveClusters()).toHaveLength(2);
    expect(pool.countClusters()).toBe(2);
  });

  it('движок не держит массивы вакансий в памяти процесса: poolSize и выборка идут из базы', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pool-memory-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');

    const pool = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(pool);
    pool.replaceSourceSlice(SOURCE.id, [vacancy('v1'), { ...vacancy('v2'), company: 'Globex' }]);

    const engine = new MultiSourceVacancyEngine({ sources: [SOURCE], pool });
    await engine.restoreAsync();
    if (engine.getActiveClusters().length === 0 && engine.poolSize > 0) {
      await engine.reclusterAsync();
    }

    // В инстансе движка нет массивов полных вакансий
    const engineInternals = engine as unknown as Record<string, unknown>;
    expect(engineInternals.pendingVacancies).toEqual([]);
    expect(engineInternals).not.toHaveProperty('vacancies');

    // poolSize и getVacancies обращаются в хранилище
    const countSpy = vi.spyOn(pool, 'countVacancies');
    const querySpy = vi.spyOn(pool, 'queryVacancies');

    expect(engine.poolSize).toBe(2);
    expect(countSpy).toHaveBeenCalled();

    const result = engine.getVacancies({ query: 'Globex' });
    expect(querySpy).toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('v2');
  });
});

