/**
 * B752: замер разбиения кластеров на копии базы, только чтение.
 * npx tsx scripts/cluster-split-dry-run.ts <путь к копии базы> [--limit N]
 */
import { DatabaseSync } from 'node:sqlite';
import { runClusterSplitDryRun } from '../server/vacancies/clusterSplit';

function parseArgs(argv: readonly string[]): { path: string; limit?: number } {
  const [path, ...rest] = argv;
  if (!path) throw new Error('usage: cluster-split-dry-run.ts <db path> [--limit N]');
  const at = rest.indexOf('--limit');
  const limit = at >= 0 ? Number(rest[at + 1]) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    throw new Error('--limit must be a positive integer');
  }
  return limit === undefined ? { path } : { path, limit };
}

const { path, limit } = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(path, { readOnly: true });
const started = performance.now();
const counts = runClusterSplitDryRun(db, limit === undefined ? {} : { limit });
const elapsedMs = Math.round(performance.now() - started);
db.close();
process.stdout.write(
  `${JSON.stringify({ ...counts, jobsUpperBound: counts.splitWithRequirements, elapsedMs }, null, 2)}\n`,
);
