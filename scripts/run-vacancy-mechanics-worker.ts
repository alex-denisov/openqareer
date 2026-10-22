import { currentVacancyFitProfileValidator } from '../server/domain/vacancyFitProfileStamp';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { VacancyMechanicsRuntime } from '../server/domain/vacancyMechanicsRuntime';
import { createBulkLlmRuntime } from '../server/providers/bulkLlmRuntime';
import { runVacancyMechanicsStep } from '../server/domain/vacancyMechanicsLoop';
import { formatVacancyMechanicsStats } from '../server/domain/vacancyMechanicsStats';

const BATCH_LOG_MS = 60_000;
/**
 * Model calls in flight at once (B510). Jobs are leased, so lanes never take the same job, and
 * every call still passes the B522 budget reservation: lanes change speed, not spend. One lane
 * at ~12 s per call left a candidate's first page without percentages for over an hour.
 */
const WORKER_LANES = 3;

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
process.once('SIGTERM', () => {
  stopping = true;
});
process.once('SIGINT', () => {
  stopping = true;
});
try {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (process.argv.includes('--once')) await runtime.runNext(bulk.client);
  else if (!process.argv.includes('--migrate-only')) {
    const requeued = runtime.requeueAfterParserUpgrade();
    console.info(
      `vacancy-mechanics start: requeued requirements=${requeued.requirements} fit=${requeued.fit}`,
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
    await Promise.all(Array.from({ length: WORKER_LANES }, () => lane()));
  }
} finally {
  bulk.close();
  runtime.close();
  candidates.close();
}
