import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { composeVacancyEngine } from '../vacancies/composeVacancyEngine';
import { SqliteVacancyPoolStore } from '../vacancies/sqliteVacancyPoolStore';
import { clusterVacancies } from '../vacancies/vacancyDeduplicator';
import { MaintenanceWorker, type MaintenanceLog } from './maintenanceWorker';

/**
 * B230, срез 1: одна волна обслуживателя пишет срез площадки в файловую базу,
 * пока «HTTP-процесс» (другой поток) пишет в ту же базу каждые 20 мс. Ни одной
 * `SQLITE_BUSY`, и ни одна чужая запись не ждала дольше секунды — значит,
 * транзакции волны короче секунды.
 */
function source(id: string): VacancySourceConfig {
  return {
    id,
    name: id,
    type: 'json_api',
    enabled: true,
    targetUrl: `https://${id}.example/jobs`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

function vacancy(source: VacancySourceConfig, index: number): UnifiedVacancy {
  return {
    id: `${source.id}:${index}`,
    fingerprint: `${source.id}:${index}`,
    title: `Engineer ${index}`,
    company: `Firm ${index}Q`,
    description: 'React, TypeScript '.repeat(20),
    requiredSkills: ['React'],
    url: `${source.targetUrl}/${index}`,
    provenance: {
      sourceType: source.type,
      sourceId: source.id,
      sourceUrl: `${source.targetUrl}/${index}`,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

function silentLog(): MaintenanceLog & { entries: Array<{ level: string; msg: string }> } {
  const entries: Array<{ level: string; msg: string }> = [];
  const push = (level: string) => (_: unknown, msg: string) => {
    entries.push({ level, msg });
  };
  return { entries, info: push('info'), warn: push('warn'), error: push('error') };
}

/** Соперник за write-lock: пишет строку каждые 20 мс и меряет ожидание. */
function startConcurrentWriter(databasePath: string): {
  stop(): Promise<{ writes: number; errors: number; maxWaitMs: number }>;
} {
  const worker = new Worker(
    `
    const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const db = new DatabaseSync(workerData.databasePath);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('CREATE TABLE IF NOT EXISTS http_probe (at INTEGER)');
    const stats = { writes: 0, errors: 0, maxWaitMs: 0 };
    let running = true;
    parentPort.on('message', () => { running = false; });
    const tick = () => {
      if (!running) { db.close(); parentPort.postMessage(stats); return; }
      const started = Date.now();
      try { db.prepare('INSERT INTO http_probe (at) VALUES (?)').run(started); stats.writes += 1; }
      catch { stats.errors += 1; }
      stats.maxWaitMs = Math.max(stats.maxWaitMs, Date.now() - started);
      setTimeout(tick, 20);
    };
    tick();
    `,
    { eval: true, workerData: { databasePath } },
  );
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        worker.once('message', (stats) => {
          void worker.terminate().then(() => resolve(stats));
        });
        worker.once('error', reject);
        worker.postMessage('stop');
      }),
  };
}

describe('MaintenanceWorker (B230)', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it('one wave writes a source slice while another process keeps writing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'maintenance-worker-'));
    directories.push(directory);
    const databasePath = join(directory, 'db.sqlite');
    const composed = composeVacancyEngine({
      databasePath,
      fetcher: async (source) => Array.from({ length: 300 }, (_, i) => vacancy(source, i)),
      recluster: { mode: 'keyed', batchSize: 100 },
    });
    const log = silentLog();
    const worker = new MaintenanceWorker({ engine: composed.engine, log });
    const rival = startConcurrentWriter(databasePath);

    await worker.restore();
    const wave = await worker.runSyncWave();
    const stats = await rival.stop();

    expect(wave.synced).toBeGreaterThan(0);
    expect(wave.failed).toEqual([]);
    expect(composed.engine.poolSize).toBeGreaterThan(0);
    expect(stats.errors).toBe(0);
    expect(stats.writes).toBeGreaterThan(0);
    expect(stats.maxWaitMs).toBeLessThan(1000);
    expect(log.entries.some((e) => e.msg === 'multi-source-sync-completed')).toBe(true);
    // Волна свела улов по ключам, а не отложила его.
    expect(composed.pool.countClusters()).toBeGreaterThan(0);
    expect(composed.engine.reclusterStats.rebuilds).toBe(0);
    composed.close();
  }, 60_000);

  it('stop waits for the running wave and then rejects new ones', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'maintenance-worker-'));
    directories.push(directory);
    const composed = composeVacancyEngine({
      databasePath: join(directory, 'db.sqlite'),
      fetcher: async (source) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [vacancy(source, 1)];
      },
      recluster: { mode: 'off' },
    });
    const worker = new MaintenanceWorker({ engine: composed.engine, log: silentLog() });
    await worker.restore();
    const wave = worker.runSyncWave();
    await worker.stop();
    await expect(wave).resolves.toMatchObject({ failed: [] });
    await expect(worker.runSyncWave()).resolves.toEqual({
      synced: 0,
      failed: [],
      kept: 0,
      skipped: 'stopped',
    });
    composed.close();
  }, 60_000);

  it('restore backfills cluster keys of pre-B230 clusters before any wave', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'maintenance-worker-'));
    directories.push(directory);
    const databasePath = join(directory, 'db.sqlite');
    const seed = new SqliteVacancyPoolStore({ databasePath });
    seed.replaceClusters(
      clusterVacancies(Array.from({ length: 1_100 }, (_, i) => vacancy(source('seed'), i))),
    );
    seed.close();
    const stripped = new DatabaseSync(databasePath);
    stripped.exec(
      'DELETE FROM vacancy_cluster_keys; UPDATE cluster_keys_backfill_state SET cursor_rowid = 0, completed = 0',
    );
    stripped.close();

    const composed = composeVacancyEngine({
      databasePath,
      fetcher: async () => [],
      recluster: { mode: 'keyed', batchSize: 100 },
    });
    const log = silentLog();
    const worker = new MaintenanceWorker({ engine: composed.engine, log });
    expect(composed.engine.clusterKeysReady).toBe(false);
    expect(await worker.runSyncWave()).toMatchObject({ skipped: 'keys' });

    await worker.restore();

    expect(composed.engine.clusterKeysReady).toBe(true);
    expect(log.entries.some((e) => e.msg === 'cluster-keys-backfill-finished')).toBe(true);
    expect(
      composed.pool.loadClustersByKeys([
        {
          direct: [{ kind: 'url', key: 'https://seed.example/jobs/7' }],
          companyTokens: [],
          titleTokens: [],
        },
      ]),
    ).toHaveLength(1);
    composed.close();
  });

  it('refuses to restore an engine without sources (prune would wipe the pool)', async () => {
    const worker = new MaintenanceWorker({
      engine: {
        getSources: () => [],
        restoreAsync: async () => ({ restored: 0 }),
        syncDue: async () => [],
        probeDueLinks: async () => undefined,
        runCatalogMaintenanceStep: () => undefined,
        runClusterKeysBackfillStep: () => 0,
        clusterKeysReady: true,
        poolSize: 0,
      },
      log: silentLog(),
    });
    await expect(worker.restore()).rejects.toThrow(/sources/);
  });
});
