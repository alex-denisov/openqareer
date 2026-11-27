import { afterEach, describe, expect, it } from 'vitest';
import { CareersPrune } from '../../../companyDirectory/siteDiscovery/careersPrune';
import { PendingQueue } from '../../../companyDirectory/siteDiscovery/siteDiscoverySchedule';
import { fetchGenericCorporateVacancies } from '../../genericCorporateSiteAdapter';
import { SqliteVacancyPoolStore } from '../../sqliteVacancyPoolStore';
import { freshnessWindow } from '../../vacancyPoolQuery';
import { dynamicLoadPromoteFn, createOfflineEngine, makeSource, makeVacancy, cleanupTrackedStores } from './helpers/engineHarness';
import { MEMORY_LIMITS, createMemoryTracker, runMemoryWorkerSubprocess } from './helpers/memoryProbe';
import { createMockFetchRouter, restoreMockFetch } from './helpers/mockFetch';
import {
  bootstrapPoolTables,
  cleanupAllSqliteHarnesses,
  createMemoryDb,
  createTempDbWorkspace,
  seedDirectoryCompany,
  seedFreehireCandidate,
  seedSourceState,
} from './helpers/sqliteHarness';

afterEach(() => {
  restoreMockFetch();
  cleanupTrackedStores();
  cleanupAllSqliteHarnesses();
});

describe('E2E-12: Synthetic Memory Compliance Harness (640 MB Heap / 900 MB RSS, F16)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 subprocess under NODE_OPTIONS=--max-old-space-size=640 keeps peak <640M/<900M and O(chunk) queue delta', async () => {
    const ws = createTempDbWorkspace('oq-mem-');
    const report = await runMemoryWorkerSubprocess(ws.dir, 2_000, 20_000);

    expect(report.exitCode, `Worker stderr: ${report.stderr}`).toBe(0);
    expect(report.peakHeapBytes).toBeLessThan(MEMORY_LIMITS.heapLimitBytes);
    expect(report.peakRssBytes).toBeLessThan(MEMORY_LIMITS.rssLimitBytes);
    expect(report.queueDelta20kBytes).toBeLessThan(64 * 1024 * 1024);
    const scaleRatio = report.queueDelta20kBytes / Math.max(report.queueDelta2kBytes, 1024 * 1024);
    expect(scaleRatio).toBeLessThan(3.0);
  });

  it('T1.2 chunked bulk promote (F7) processes 2,000 candidates with bounded memory', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote, 'F7 bulk promote must be implemented').not.toBeNull();

    const db = createMemoryDb();
    db.exec('BEGIN IMMEDIATE');
    for (let i = 0; i < 2_000; i += 1) {
      const key = `mem-cand-${String(i).padStart(4, '0')}`;
      seedDirectoryCompany(db, { companyKey: key, companyName: `MemCand ${i}` });
      seedFreehireCandidate(db, key, {
        slug: key,
        name: `MemCand ${i}`,
        website: `https://${key}.example/`,
      });
    }
    db.exec('COMMIT');

    const tracker = createMemoryTracker();
    const res = await promote!(db, { chunkSize: 250 });
    tracker.record();
    expect(res.promoted).toBe(2_000);
    expect(tracker.deltaHeapBytes).toBeLessThan(64 * 1024 * 1024);
  });

  it('T1.3 SqliteVacancyPoolStore + keyed recluster syncs 1,000+ vacancies under memory budget', async () => {
    const ws = createTempDbWorkspace('oq-pool-mem-');
    const sources = Array.from({ length: 20 }, (_, i) =>
      makeSource({
        id: `ats-greenhouse-batch-${i}`,
        name: `BatchCo ${i}`,
        channelTier: 1,
        targetUrl: `https://batch-${i}.example/jobs`,
      }),
    );
    const tracker = createMemoryTracker();
    const wrapped = createOfflineEngine({
      sources,
      databasePath: ws.dbPath,
      recluster: { mode: 'keyed', batchSize: 100 },
      fetcher: async (src) =>
        Array.from({ length: 50 }, (_, j) =>
          makeVacancy({ id: `${src.id}-v-${j}`, sourceId: src.id, company: src.name }),
        ),
    });
    await wrapped.engine.syncDue(Date.UTC(2026, 10, 24, 12));
    tracker.record();
    expect(wrapped.pool.countVacancies(freshnessWindow(Date.UTC(2026, 10, 25)))).toBe(1_000);
    expect(tracker.peakHeapBytes).toBeLessThan(MEMORY_LIMITS.heapLimitBytes);
  });

  it('T1.4 CareersPrune sweeps 1,500 vacancy_source_state rows in bounded chunks', () => {
    const db = createMemoryDb();
    bootstrapPoolTables(db);
    db.exec('BEGIN IMMEDIATE');
    for (let i = 0; i < 1_500; i += 1) {
      const key = `prune-mem-${String(i).padStart(4, '0')}`;
      seedDirectoryCompany(db, {
        companyKey: key,
        companyName: `PruneMem ${i}`,
        careersUrl: `https://${key}.example/careers`,
        evidence: { careersUrlSetAt: '2026-11-01T00:00:00Z' },
      });
      seedSourceState(db, {
        sourceId: `src-company-site-${key}`,
        lastStatus: 'error',
        lastErrorMessage: 'vacancy_source_unreachable: 404',
        observations: { firstReadingAt: '2026-11-02T00:00:00Z', windowReadings: 4, consecutiveEmptyReadings: 4 },
      });
    }
    db.exec('COMMIT');

    const tracker = createMemoryTracker();
    const prune = new CareersPrune(db, { chunk: 200, now: () => Date.UTC(2026, 10, 24) });
    let chunks = 0;
    let totalDropped = 0;
    for (;;) {
      const step = prune.step();
      chunks += 1;
      totalDropped += step.dropped;
      tracker.record();
      if (step.done) break;
    }
    expect(chunks).toBeGreaterThanOrEqual(8);
    expect(totalDropped).toBe(1_500);
    expect(tracker.deltaHeapBytes).toBeLessThan(48 * 1024 * 1024);
  });

  it('T1.5 PendingQueue avoids loading whole directory into unbounded heap when reading bounded batches', async () => {
    const db = createMemoryDb();
    db.exec('BEGIN IMMEDIATE');
    for (let i = 0; i < 3_000; i += 1) {
      const key = `pq-${String(i).padStart(5, '0')}`;
      seedDirectoryCompany(db, {
        companyKey: key,
        companyName: `PQ ${i}`,
        websiteUrl: `https://${key}.example/`,
      });
    }
    db.exec('COMMIT');

    const tracker = createMemoryTracker();
    const queue = new PendingQueue(db);
    const batch = await queue.next(50);
    tracker.record();
    expect(batch).toHaveLength(50);
    // O(chunk) PendingQueue should not cache all 3,000+ items on heap (should be < 2 MB delta)
    expect(tracker.deltaHeapBytes).toBeLessThan(8 * 1024 * 1024);
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 memoryTracker captures peak heap and RSS accurately across async yields', async () => {
    const tracker = createMemoryTracker();
    await new Promise((resolve) => setImmediate(resolve));
    const sample = tracker.record();
    expect(sample.heapUsed).toBeGreaterThan(0);
    expect(tracker.peakHeapBytes).toBeGreaterThanOrEqual(sample.heapUsed);
    expect(tracker.peakRssBytes).toBeGreaterThanOrEqual(sample.rss);
  });

  it('T2.2 SQLite WAL chunked writes commit cleanly without leaving open transactions', () => {
    const ws = createTempDbWorkspace('oq-wal-mem-');
    const pool = new SqliteVacancyPoolStore({ databasePath: ws.dbPath });
    try {
      pool.replaceSourceSlice('ats-greenhouse-wal', [
        makeVacancy({ id: 'wal-1', sourceId: 'ats-greenhouse-wal', company: 'WalCo' }),
      ]);
      expect(pool.countSourceSlice('ats-greenhouse-wal').total).toBe(1);
    } finally {
      pool.close();
    }
  });

  it('T2.3 oversized 2 MB corporate HTML payload is bounded without heap explosion', async () => {
    const padding = '<div>filler corporate copy</div>'.repeat(60_000);
    const html = `<!doctype html><html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Staff Systems Engineer","url":"https://big-corp.example/jobs/1","datePosted":"2026-11-22","description":"Build reliable infrastructure."}</script></head><body>${padding}</body></html>`;
    createMockFetchRouter([{ match: 'big-corp.example', respond: { status: 200, body: html } }]).install();

    const tracker = createMemoryTracker();
    const jobs = await fetchGenericCorporateVacancies(
      makeSource({
        id: 'src-company-site-bigcorp',
        name: 'BigCorp',
        type: 'career_site',
        targetUrl: 'https://big-corp.example/careers',
      }),
    );
    tracker.record();
    expect(jobs).toHaveLength(1);
    expect(tracker.peakHeapBytes).toBeLessThan(MEMORY_LIMITS.heapLimitBytes);
  });

  it('T2.4 SqliteVacancyPoolStore countVacancies and queryVacancies operate in O(page) regardless of pool size', () => {
    const ws = createTempDbWorkspace('oq-page-mem-');
    const pool = new SqliteVacancyPoolStore({ databasePath: ws.dbPath });
    try {
      const vacancies = Array.from({ length: 500 }, (_, i) =>
        makeVacancy({ id: `pg-${i}`, sourceId: 'ats-greenhouse-page', company: 'PageCo' }),
      );
      pool.replaceSourceSlice('ats-greenhouse-page', vacancies);
      const tracker = createMemoryTracker();
      const page = pool.queryVacancies({
        window: freshnessWindow(Date.UTC(2026, 10, 25)),
        offset: 0,
        limit: 20,
      });
      tracker.record();
      expect(page.items).toHaveLength(20);
      expect(page.total).toBe(500);
      expect(tracker.deltaHeapBytes).toBeLessThan(16 * 1024 * 1024);
    } finally {
      pool.close();
    }
  });

  it('T2.5 empty SQLite database in CareersPrune and PendingQueue uses near-zero memory', async () => {
    const db = createMemoryDb();
    bootstrapPoolTables(db);
    const tracker = createMemoryTracker();
    const queue = new PendingQueue(db);
    const items = await queue.next(100);
    const prune = new CareersPrune(db).step();
    tracker.record();
    expect(items).toEqual([]);
    expect(prune.done).toBe(true);
    expect(tracker.deltaHeapBytes).toBeLessThan(8 * 1024 * 1024);
  });
});
