import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CareersPrune } from '../../../../companyDirectory/siteDiscovery/careersPrune';
import { PendingQueue } from '../../../../companyDirectory/siteDiscovery/siteDiscoverySchedule';
import { makeSource, makeVacancy, createOfflineEngine, dynamicLoadPromoteFn } from './engineHarness';
import { createMemoryTracker, sampleMemory } from './memoryProbe';
import { bootstrapE2eSchema, bootstrapPoolTables } from './sqliteHarness';

function insertSyntheticBatch(db: DatabaseSync, count: number, offset: number): void {
  const insDir = db.prepare(
    `INSERT INTO company_directory (
       company_key, company_name, website_url, careers_url, linkedin_url,
       linkedin_org_id, source_type, ats_provider, ats_slug, status,
       created_at, updated_at, evidence
     ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'active', '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z', ?)`,
  );
  const insCand = db.prepare(
    `INSERT INTO freehire_company_source_candidates (slug, evidence, fetched_at) VALUES (?, ?, '2026-11-20T00:00:00Z')`,
  );
  const insPlace = db.prepare(
    `INSERT INTO company_placement (placement_id, company_key, type, provider, slug, priority, discovered_by, updated_at)
     VALUES (?, ?, 'ats', 'greenhouse', ?, 2, 'freehire', 1795132800000)`,
  );
  const insVc = db.prepare(
    `INSERT INTO vacancy_company (vacancy_id, company_key, match_how, linked_at) VALUES (?, ?, 'exact_name', 1795132800000)`,
  );
  for (let i = 0; i < count; i += 1) {
    const idx = offset + i;
    const key = `comp-${String(idx).padStart(6, '0')}`;
    const hasSource = idx % 7 === 0;
    const site = hasSource ? `https://${key}.example/` : null;
    insDir.run(key, `Company ${idx}`, site, null, null, hasSource ? 'ats_direct' : 'linkedin_guest', hasSource ? 'greenhouse' : null, hasSource ? key : null, null);
    insCand.run(key, JSON.stringify({ slug: key, name: `Company ${idx}`, website: `https://${key}.example/`, boards: [{ provider: 'greenhouse', slug: key }] }));
    if (idx % 5 === 0) insPlace.run(`ats:greenhouse:${key}`, key, key);
    if (idx % 4 === 0) insVc.run(`vac-${idx}`, key);
  }
}

function seedSyntheticDataset(db: DatabaseSync, totalRows: number): void {
  const chunk = 1_000;
  for (let offset = 0; offset < totalRows; offset += chunk) {
    db.exec('BEGIN IMMEDIATE');
    try {
      insertSyntheticBatch(db, Math.min(chunk, totalRows - offset), offset);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function seedSourceStates(db: DatabaseSync, count: number): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO vacancy_source_state (source_id, last_sync_at, last_status, items_found_total, items_active_total, observations)
     VALUES (?, '2026-11-20T00:00:00Z', 'healthy', 0, 0, ?)`,
  );
  const obs = JSON.stringify({ firstReadingAt: '2026-11-01T00:00:00Z', windowReadings: 4, consecutiveEmptyReadings: 4 });
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let i = 0; i < count; i += 1) {
      stmt.run(`src-company-site-comp-${String(i).padStart(6, '0')}`, obs);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

async function measureQueueStage(db: DatabaseSync): Promise<number> {
  const before = sampleMemory().heapUsed;
  const queue = new PendingQueue(db);
  await queue.next(200);
  const after = sampleMemory().heapUsed;
  return Math.max(0, after - before);
}

async function measurePoolAndEngineStage(dbPath: string): Promise<number> {
  const before = sampleMemory().heapUsed;
  const sources = Array.from({ length: 50 }, (_, i) =>
    makeSource({ id: `ats-greenhouse-mem-${i}`, name: `MemCo ${i}` }),
  );
  const wrapped = createOfflineEngine({
    sources,
    databasePath: dbPath,
    recluster: { mode: 'keyed', batchSize: 100 },
    fetcher: async (src) => [
      makeVacancy({ id: `${src.id}-1`, sourceId: src.id, company: src.name }),
      makeVacancy({ id: `${src.id}-2`, sourceId: src.id, company: src.name }),
    ],
  });
  try {
    await wrapped.engine.syncDue(Date.UTC(2026, 10, 25));
  } finally {
    wrapped.close();
  }
  const after = sampleMemory().heapUsed;
  return Math.max(0, after - before);
}

async function run20kStages(db20kPath: string, rows20k: number, tracker: ReturnType<typeof createMemoryTracker>) {
  const db20k = new DatabaseSync(db20kPath);
  bootstrapE2eSchema(db20k);
  bootstrapPoolTables(db20k);
  seedSyntheticDataset(db20k, rows20k);
  seedSourceStates(db20k, 2_000);
  const queueDelta20kBytes = await measureQueueStage(db20k);
  tracker.record();

  const pruneBefore = sampleMemory().heapUsed;
  const prune = new CareersPrune(db20k, { chunk: 200 });
  while (!prune.step().done) tracker.record();
  const pruneDeltaBytes = Math.max(0, sampleMemory().heapUsed - pruneBefore);

  const promoteFn = await dynamicLoadPromoteFn();
  let promoteDeltaBytes: number | null = null;
  if (promoteFn) {
    const beforePromote = sampleMemory().heapUsed;
    await promoteFn(db20k, { chunkSize: 500 });
    tracker.record();
    promoteDeltaBytes = Math.max(0, sampleMemory().heapUsed - beforePromote);
  }
  db20k.close();
  return { queueDelta20kBytes, pruneDeltaBytes, promoteDeltaBytes };
}

async function runWorker(): Promise<void> {
  const startedAt = Date.now();
  const dbDir = process.argv[2];
  const rows2k = Number(process.argv[3] ?? '2000');
  const rows20k = Number(process.argv[4] ?? '20000');
  const tracker = createMemoryTracker();

  const db2k = new DatabaseSync(join(dbDir, 'mem-2k.sqlite'));
  bootstrapE2eSchema(db2k);
  bootstrapPoolTables(db2k);
  seedSyntheticDataset(db2k, rows2k);
  const queueDelta2kBytes = await measureQueueStage(db2k);
  tracker.record();
  db2k.close();

  const db20kPath = join(dbDir, 'mem-20k.sqlite');
  const stage20k = await run20kStages(db20kPath, rows20k, tracker);
  const poolSyncDeltaBytes = await measurePoolAndEngineStage(db20kPath);
  tracker.record();

  const output = {
    peakHeapBytes: tracker.peakHeapBytes,
    peakRssBytes: tracker.peakRssBytes,
    baselineHeapBytes: tracker.baselineHeapBytes,
    queueDelta2kBytes,
    ...stage20k,
    poolSyncDeltaBytes,
    durationMs: Date.now() - startedAt,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

void runWorker();
