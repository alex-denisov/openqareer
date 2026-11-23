import { currentVacancyFitProfileValidator } from '../server/domain/vacancyFitProfileStamp';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { VacancyMechanicsRuntime } from '../server/domain/vacancyMechanicsRuntime';
import { createBulkLlmRuntime } from '../server/providers/bulkLlmRuntime';
import { runVacancyMechanicsStep } from '../server/domain/vacancyMechanicsLoop';
import { formatVacancyMechanicsStats } from '../server/domain/vacancyMechanicsStats';
import { vacancyMechanicsLanes } from '../server/domain/vacancyMechanicsLanes';
import { createJsonLineLog } from '../server/maintenance/jsonLineLog';
import { watchWriteHolds } from '../server/observability/sqliteWriteHolds';
import { runSupersededPurge } from '../server/domain/supersededFitPurge';

const BATCH_LOG_MS = 60_000;
const log = createJsonLineLog();
watchWriteHolds((hold) =>
  log.warn({ ...hold, heldMs: Math.round(hold.heldMs) }, 'write-lock-held-long'),
);
const WORKER_LANES = vacancyMechanicsLanes(process.env);

const path = process.env.OPENQAREER_DATABASE_PATH;
const key = process.env.OPENQAREER_DATA_ENCRYPTION_KEY;
if (!path || !key)
  throw new Error('Database path and encryption key must be explicitly configured');
const candidates = new SqliteCandidateStore({
  databasePath: path,
  encryptionKey: Buffer.from(key, 'base64'),
});
const runtime = new VacancyMechanicsRuntime(
  path,
  Buffer.from(key, 'base64'),
  currentVacancyFitProfileValidator(candidates),
);
const bulk = createBulkLlmRuntime({ databasePath: path });
let stopping = false;
const stopped = new AbortController();
const stop = () => {
  stopping = true;
  stopped.abort();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
/** A wait that a stop ends at once, so an hourly pause never holds the worker's exit. */
const stoppableSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    if (stopped.signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      stopped.signal.removeEventListener('abort', done);
      resolve();
    }
    stopped.signal.addEventListener('abort', done, { once: true });
  });
try {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (process.argv.includes('--once')) await runtime.runNext(bulk.client);
  else if (!process.argv.includes('--migrate-only')) {
    const requeued = runtime.requeueAfterParserUpgrade();
    console.info(
      `vacancy-mechanics start: requeued requirements=${requeued.requirements} fit=${requeued.fit} labels=${requeued.labels}`,
    );
    let batchStartedAt = Date.now();
    // One worker id for every lane: the B522 budget run is keyed by it, so lanes share one budget.
    const lane = async () => {
      while (!stopping) {
        await runVacancyMechanicsStep(() => runtime.runNext(bulk.client), sleep);
        const elapsed = Date.now() - batchStartedAt;
        if (elapsed < BATCH_LOG_MS) continue;
        batchStartedAt = Date.now();
        const line = formatVacancyMechanicsStats(runtime.takeStats(), elapsed);
        if (line) console.info(line);
      }
    };
    const purge = runSupersededPurge({
      batch: () => runtime.purgeSupersededFitBatch(),
      sleep: stoppableSleep,
      stopping: () => stopping,
      log: (removed) => console.info(`vacancy-mechanics: removed superseded fit jobs=${removed}`),
      warn: (error) =>
        console.warn(
          `vacancy-mechanics: superseded fit purge paused until the next hour: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
    });
    await Promise.all([...Array.from({ length: WORKER_LANES }, () => lane()), purge]);
  }
} finally {
  bulk.close();
  runtime.close();
  candidates.close();
}
