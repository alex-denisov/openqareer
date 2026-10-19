import { currentVacancyFitProfileValidator } from '../server/domain/vacancyFitProfileStamp';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { VacancyMechanicsRuntime } from '../server/domain/vacancyMechanicsRuntime';
import { createBulkLlmRuntime } from '../server/providers/bulkLlmRuntime';

const path = process.env.OPENQAREER_DATABASE_PATH;
const key = process.env.OPENQAREER_DATA_ENCRYPTION_KEY;
if (!path || !key) throw new Error('Database path and encryption key must be explicitly configured');
const candidates = new SqliteCandidateStore({ databasePath: path, encryptionKey: Buffer.from(key, 'base64') });
const runtime = new VacancyMechanicsRuntime(path, Buffer.from(key, 'base64'), currentVacancyFitProfileValidator(candidates));
const bulk = createBulkLlmRuntime({ databasePath: path });
let stopping = false;
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });
try {
  if (!process.argv.includes('--migrate-only')) do {
    const processed = await runtime.runNext(bulk.client);
    if (process.argv.includes('--once')) break;
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
} finally { bulk.close(); runtime.close(); candidates.close(); }
