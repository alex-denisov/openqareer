// One pass, run by hand on prod (05.11): rows a fallback model answered are asked of Vertex once.
// Usage: fit-fallback-recount.mjs dry | run. Prints counts and vacancy ids only.
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { SealedText } from '../server/data/sealedText';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { SqliteVacancyFitStore } from '../server/data/sqliteVacancyFitStore';
import { SqliteVacancyRequirementsStore } from '../server/data/sqliteVacancyRequirementsStore';
import { VACANCY_FIT_ALGORITHM_VERSION } from '../shared/vacancyFit';
import { FALLBACK_RECOUNT_TASK, askVertexOnce, recountFallbackRows, type FallbackRecountRow } from '../server/domain/vacancyFitFallbackRecount';
import { VACANCY_REQUIREMENTS_EXTRACTOR_VERSION, vacancyDescriptionHash } from '../server/domain/vacancyRequirements';
import { createBulkLlmRuntime } from '../server/providers/bulkLlmRuntime';
import { createVacancyFitContextReader, readVacancyFitTarget } from '../server/routes/vacancyFitContext';
import { MultiSourceVacancyEngine } from '../server/vacancies/multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from '../server/vacancies/sqliteVacancyPoolStore';
import { SqliteTitleParseStore } from '../server/vacancies/titleParse/sqliteTitleParseStore';

const path = process.env.OPENQAREER_DATABASE_PATH!;
const key = Buffer.from(process.env.OPENQAREER_DATA_ENCRYPTION_KEY!, 'base64');
const database = new DatabaseSync(path);
database.exec('PRAGMA busy_timeout=5000');
const store = new SqliteVacancyFitStore(database, new SealedText(key));
const requirements = new SqliteVacancyRequirementsStore(database);
const deps = {
  candidateStore: new SqliteCandidateStore({ databasePath: path, encryptionKey: key }),
  titleParseStore: new SqliteTitleParseStore({ databasePath: path }),
  multiSourceEngine: new MultiSourceVacancyEngine({ pool: new SqliteVacancyPoolStore({ databasePath: path }), fetcher: async () => [] } as never),
} as never;
const contexts = new Map<string, ReturnType<typeof createVacancyFitContextReader>>();
const contextOf = (candidateId: string) => contexts.get(candidateId) ?? contexts.set(candidateId, createVacancyFitContextReader(deps, candidateId)).get(candidateId)!;
const resolve = (row: FallbackRecountRow) => {
  const target = readVacancyFitTarget(deps, row.vacancyId);
  if (!target) return undefined;
  const extracted = requirements.getLatestOrLegacy(row.vacancyId, vacancyDescriptionHash(target.description));
  if (extracted?.extractorVersion !== VACANCY_REQUIREMENTS_EXTRACTOR_VERSION) return undefined;
  return { ...contextOf(row.candidateId)(target, []), requirements: extracted.requirements };
};
const day = () => new Date().toISOString().slice(0, 10);
const spent = database.prepare('SELECT COALESCE(SUM(cost),0) AS usd, COUNT(*) AS calls FROM bulk_llm_spend WHERE task=? AND day=?');
const spentToday = () => (spent.get(FALLBACK_RECOUNT_TASK, day()) as { usd: number }).usd;
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (process.argv[2] !== 'run') {
  const rows = store.fallbackRows();
  print({ mode: 'dry', rows: rows.length, current: rows.filter((row) => { const input = resolve(row); return input && store.cacheKey(input) === row.key; }).length });
  process.exit(0);
}
const runtime = createBulkLlmRuntime({ databasePath: path });
if (!runtime.client) { print({ stop: 'no bulk channel' }); process.exit(2); }
const { client } = runtime;
const runId = `fit-fallback-recount-${day()}`;
const report = await recountFallbackRows({
  rows: () => store.fallbackRows(),
  resolve,
  keyOf: (input) => store.cacheKey(input),
  mark: (row) => store.markFallbackRecount(row.key),
  release: (row) => store.releaseFallbackRecount(row.key),
  ask: async (input) => {
    const startedAt = Date.now();
    const outcome = await askVertexOnce(client, runId, input);
    print({ vacancyId: input.vacancyId, kind: outcome.kind, ms: Date.now() - startedAt, ...(outcome.kind === 'no_answer' ? { failure: outcome.failure } : {}) });
    return outcome;
  },
  write: (input, result, answeredBy) => store.putCache(input, result, undefined, VACANCY_FIT_ALGORITHM_VERSION, answeredBy),
  spentToday,
  sleep: (ms) => sleep(ms),
});
print({ report, spent: spent.get(FALLBACK_RECOUNT_TASK, day()) });
process.exit(0);
