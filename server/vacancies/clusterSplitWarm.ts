import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { tableExists } from './clusterSplit';
import { CATALOG_CLUSTER_TABLES } from './clusterSplitJournal';
import type { PlannedSplit } from './clusterSplitPlan';
import { catalogEntryRowOfCluster } from './vacancyCatalogProjection';
import { clusterKeys } from './vacancyDeduplicator';

/**
 * B752: страницы базы, которые тронет запись, читаются до транзакции. На холодном
 * кэше вставка ключей и снятие прежних ждут диск уже под блокировкой записи:
 * 25.11, копия прода, первый шаг — 3 532 мс. Здесь только чтения.
 */

type Read = (...values: SQLInputValue[]) => Record<string, SQLInputValue> | undefined;

interface Probes {
  readonly keyPage: Read;
  readonly fingerprint: Read;
  readonly freshness: Read;
  readonly clusterRow: Read;
  readonly catalogRow: Read;
  readonly redirect: Read;
  /** Листья индексов каталога, куда ляжет строка. */
  readonly catalogIndexes: readonly ((row: CatalogPosition) => void)[];
  readonly byCluster: readonly Read[];
  readonly keysOf: (id: string) => { kind: string; key: string }[];
}

interface CatalogPosition {
  readonly key: string;
  readonly path: string;
  readonly status: string;
  readonly placeSlug: string | null;
  readonly roleSlug: string | null;
  readonly publishedMs: number;
}

function prepareProbes(db: DatabaseSync): Probes {
  const read = (sql: string): Read => {
    const statement = db.prepare(sql);
    return (...values) => statement.get(...values) as Record<string, SQLInputValue> | undefined;
  };
  const entryKey = read('SELECT 1 FROM catalog_entries WHERE entry_key = ?');
  const path = read(
    'SELECT 1 FROM catalog_entries WHERE status = ? AND path >= ? ORDER BY path LIMIT 1',
  );
  const order = read(
    `SELECT 1 FROM catalog_entries WHERE status = ? AND published_ms <= ?
      ORDER BY published_ms DESC LIMIT 1`,
  );
  const place = read(
    `SELECT 1 FROM catalog_entries WHERE status = ? AND place_slug IS ? AND published_ms <= ?
      ORDER BY published_ms DESC LIMIT 1`,
  );
  const role = read(
    `SELECT 1 FROM catalog_entries WHERE status = ? AND role_slug IS ? AND place_slug IS ?
        AND published_ms <= ? ORDER BY published_ms DESC LIMIT 1`,
  );
  const keys = db.prepare('SELECT kind, key FROM vacancy_cluster_keys WHERE cluster_id = ?');
  return {
    keyPage: read(
      'SELECT 1 FROM vacancy_cluster_keys WHERE kind = ? AND key = ? AND cluster_id >= ? LIMIT 1',
    ),
    fingerprint: read('SELECT 1 FROM vacancy_clusters WHERE fingerprint = ?'),
    freshness: read(
      'SELECT 1 FROM vacancy_clusters WHERE updated_at <= ? ORDER BY updated_at DESC, id LIMIT 1',
    ),
    clusterRow: read('SELECT * FROM vacancy_clusters WHERE id = ?'),
    catalogRow: read('SELECT * FROM catalog_entries WHERE cluster_id = ?'),
    redirect: read('SELECT 1 FROM vacancy_catalog_redirects WHERE old_key = ?'),
    catalogIndexes: [
      (row) => entryKey(row.key),
      (row) => path(row.status, row.path),
      (row) => order(row.status, row.publishedMs),
      (row) => place(row.status, row.placeSlug, row.publishedMs),
      (row) => role(row.status, row.roleSlug, row.placeSlug, row.publishedMs),
    ],
    byCluster: CATALOG_CLUSTER_TABLES.filter(({ table }) => tableExists(db, table)).map(
      ({ table }) => read(`SELECT * FROM ${table} WHERE cluster_id = ?`),
    ),
    keysOf: (id) => keys.all(id) as { kind: string; key: string }[],
  };
}

function warmPiece(probes: Probes, piece: VacancyCluster): void {
  probes.clusterRow(piece.id);
  probes.fingerprint(piece.id);
  probes.keysOf(piece.id);
  for (const { kind, key } of clusterKeys(piece)) probes.keyPage(kind, key, piece.id);
  for (const read of probes.byCluster) read(piece.id);
  const entry = catalogEntryRowOfCluster(piece);
  if (!entry) return;
  const position: CatalogPosition = {
    key: entry.key,
    path: entry.path,
    status: entry.status,
    placeSlug: entry.placeSlug ?? null,
    roleSlug: entry.roleSlug ?? null,
    publishedMs: Date.parse(entry.publishedAt) || 0,
  };
  for (const probe of probes.catalogIndexes) probe(position);
}

/** Прежняя строка основателя, его ключи и страница: запись снимает их из всех индексов. */
function warmOldFounder(probes: Probes, id: string): void {
  const old = probes.clusterRow(id);
  if (old) {
    probes.fingerprint(old.fingerprint!);
    probes.freshness(old.updated_at!);
  }
  for (const { kind, key } of probes.keysOf(id)) probes.keyPage(kind, key, id);
  const page = probes.catalogRow(id);
  if (!page) return;
  probes.redirect(page.entry_key!);
  const position: CatalogPosition = {
    key: String(page.entry_key),
    path: String(page.path),
    status: String(page.status),
    placeSlug: page.place_slug as string | null,
    roleSlug: page.role_slug as string | null,
    publishedMs: Number(page.published_ms),
  };
  for (const probe of probes.catalogIndexes) probe(position);
}

/** Куски плана с `from`, не больше `limit`, и основатель, если до него дойдёт очередь. */
export function warmSplit(
  db: DatabaseSync,
  plans: readonly PlannedSplit[],
  { from, limit }: { readonly from: number; readonly limit: number },
): void {
  if (plans.length === 0) return;
  const probes = prepareProbes(db);
  for (const plan of plans) {
    for (const piece of plan.pieces.slice(from, from + limit)) warmPiece(probes, piece);
    // Журнал первой части читает прежнюю строку основателя, последняя её переписывает.
    if (from > 1 && from + limit < plan.pieces.length) continue;
    warmPiece(probes, plan.pieces[0]!);
    warmOldFounder(probes, plan.cluster.id);
  }
}
