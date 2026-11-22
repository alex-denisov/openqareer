/**
 * B752: замер разбиения кластеров на копии базы.
 * npx tsx scripts/cluster-split-dry-run.ts <путь к копии базы> [--limit N]
 *   только чтение: сколько кластеров разобьётся, переездов, переадресаций, объём журнала.
 * npx tsx scripts/cluster-split-dry-run.ts <путь к копии базы> --write-copy
 *   настоящие шаги без пауз на КОПИИ: время каждого шага и итог. Прод-файл не принимается.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CLUSTER_SPLIT_TABLES } from '../server/data/clusterSplitSchema';
import { runClusterSplitDryRun } from '../server/vacancies/clusterSplit';
import { splitClustersStep } from '../server/vacancies/clusterSplitStep';

const PROD_DATABASE = '/var/lib/openqareer/openqareer.db';

interface Args {
  readonly path: string;
  readonly limit?: number;
  readonly writeCopy: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const [path, ...rest] = argv;
  if (!path)
    throw new Error('usage: cluster-split-dry-run.ts <db path> [--limit N] [--write-copy]');
  const at = rest.indexOf('--limit');
  const limit = at >= 0 ? Number(rest[at + 1]) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    throw new Error('--limit must be a positive integer');
  }
  const writeCopy = rest.includes('--write-copy');
  return limit === undefined ? { path, writeCopy } : { path, limit, writeCopy };
}

function refuseProd(path: string): void {
  if (resolve(path) === PROD_DATABASE || realpathSync(resolve(path)) === PROD_DATABASE) {
    throw new Error(`--write-copy refuses the production database ${PROD_DATABASE}`);
  }
}

function dryRun(path: string, limit: number | undefined): void {
  const db = new DatabaseSync(path, { readOnly: true });
  const started = performance.now();
  const counts = runClusterSplitDryRun(db, limit === undefined ? {} : { limit });
  const elapsedMs = Math.round(performance.now() - started);
  db.close();
  const report = { ...counts, jobsUpperBound: counts.piecesWithRequirements, elapsedMs };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function writeCopy(path: string): void {
  refuseProd(path);
  const db = new DatabaseSync(path);
  db.exec(CLUSTER_SPLIT_TABLES);
  const totals = { steps: 0, scanned: 0, split: 0, pieces: 0, catalogMoved: 0, skipped: 0 };
  const started = performance.now();
  let maxStepMs = 0;
  for (;;) {
    const at = performance.now();
    const step = splitClustersStep(db);
    const ms = Math.round(performance.now() - at);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if (step.completed) break;
    maxStepMs = Math.max(maxStepMs, ms);
    totals.steps += 1;
    totals.scanned += step.scanned;
    totals.split += step.split;
    totals.pieces += step.pieces;
    totals.catalogMoved += step.catalogMoved;
    totals.skipped += step.skippedCandidateRef + step.skippedIdTaken;
    process.stdout.write(`${JSON.stringify({ stepId: step.stepId, ms, split: step.split })}\n`);
  }
  db.close();
  const elapsedMs = Math.round(performance.now() - started);
  process.stdout.write(`${JSON.stringify({ ...totals, maxStepMs, elapsedMs }, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
if (args.writeCopy) writeCopy(args.path);
else dryRun(args.path, args.limit);
