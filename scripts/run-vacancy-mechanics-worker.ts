import { currentVacancyFitProfileValidator } from '../server/domain/vacancyFitProfileStamp';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { VacancyMechanicsRuntime } from '../server/domain/vacancyMechanicsRuntime';
import { createBulkLlmRuntime } from '../server/providers/bulkLlmRuntime';
import { runVacancyMechanicsStep } from '../server/domain/vacancyMechanicsLoop';

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
  else if (!process.argv.includes('--migrate-only'))
    while (!stopping) await runVacancyMechanicsStep(() => runtime.runNext(bulk.client), sleep);
} finally {
  bulk.close();
  runtime.close();
  candidates.close();
}
