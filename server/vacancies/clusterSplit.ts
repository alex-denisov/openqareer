import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { parseVacancy } from './sqliteVacancyPoolStore';
import { clusterKeys, clusterVacancies, sourceMemberKey } from './vacancyDeduplicator';

/**
 * B752: разбиение кластеров, склеенных голым внешним id до перехода на ключ
 * «площадка:внешний id». Планировщик чистый: члены кластера сводятся заново
 * обычными правилами (`clusterVacancies`), основатель сохраняет id кластера.
 */

const CLUSTER_PREFIX = 'cluster-';

/** Таблицы с кластером кандидата: такой кластер не разбивается (решение B752). */
export const CANDIDATE_REF_TABLES: readonly { table: string; column: string }[] = [
  { table: 'applications', column: 'cluster_id' },
  { table: 'vacancy_applications', column: 'cluster_id' },
  { table: 'vacancy_skips', column: 'cluster_id' },
  { table: 'candidate_auto_apply_queue', column: 'cluster_id' },
  { table: 'candidate_contact_messages', column: 'vacancy_id' },
  { table: 'recruiter_contacts', column: 'vacancy_id' },
];

/** Один внешний id у двух площадок — единственный след склейки голым id. */
export function hasCrossSourceIdCollision(cluster: VacancyCluster): boolean {
  const sourcesByExternalId = new Map<string, string>();
  for (const source of cluster.sources) {
    if (!source.externalId) continue;
    const seen = sourcesByExternalId.get(source.externalId);
    if (seen !== undefined && seen !== source.sourceId) return true;
    sourcesByExternalId.set(source.externalId, source.sourceId);
  }
  return false;
}

function founderOf(cluster: VacancyCluster): string {
  return cluster.id.startsWith(CLUSTER_PREFIX)
    ? cluster.id.slice(CLUSTER_PREFIX.length)
    : cluster.id;
}

/**
 * Куски кластера. Один кусок — исходный кластер без изменений. Источник, чьей
 * записи нет в пуле, остаётся у основателя: свести его заново нечем.
 */
export function planClusterSplit(
  cluster: VacancyCluster,
  vacancies: ReadonlyMap<string, UnifiedVacancy>,
): VacancyCluster[] {
  const members: UnifiedVacancy[] = [];
  const orphans: VacancyCluster['sources'] = [];
  for (const source of cluster.sources) {
    const found = vacancies.get(sourceMemberKey(source) ?? '');
    if (found) members.push(found);
    else orphans.push(source);
  }
  const rebuilt = clusterVacancies(members);
  if (rebuilt.length <= 1) return [cluster];
  const founderId = founderOf(cluster);
  const founderAt = Math.max(
    0,
    rebuilt.findIndex((piece) => piece.sources.some((s) => sourceMemberKey(s) === founderId)),
  );
  const pieces = rebuilt.map((piece, index) =>
    index === founderAt
      ? {
          ...piece,
          id: cluster.id,
          sources: [...piece.sources, ...orphans],
          vacanciesCount: piece.sources.length + orphans.length,
        }
      : piece,
  );
  const founder = pieces[founderAt]!;
  return [founder, ...pieces.filter((_, index) => index !== founderAt)].map((piece) => ({
    ...piece,
    status: cluster.status,
  }));
}

export interface ClusterSplitCounts {
  clustersScanned: number;
  clustersCollided: number;
  clustersSplit: number;
  piecesCreated: number;
  keysRewritten: number;
  catalogMoved: number;
  skippedCandidateRef: number;
  /** Разбитые кластеры, у которых уже был кэш требований: верхняя граница задач (B752). */
  splitWithRequirements: number;
}

export function tableExists(db: DatabaseSync, table: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

/** Кластеры кандидатов читаются один раз: на проде это сотни строк, не сотни тысяч. */
export function candidateReferencedClusters(db: DatabaseSync): Map<string, string> {
  const referenced = new Map<string, string>();
  for (const { table, column } of CANDIDATE_REF_TABLES) {
    if (!tableExists(db, table)) continue;
    const rows = db
      .prepare(`SELECT DISTINCT ${column} AS id FROM ${table} WHERE ${column} IS NOT NULL`)
      .all() as { id: string }[];
    for (const row of rows) if (!referenced.has(row.id)) referenced.set(row.id, table);
  }
  return referenced;
}

export function loadMemberVacancies(
  db: DatabaseSync,
  cluster: VacancyCluster,
): Map<string, UnifiedVacancy> {
  const statement = db.prepare('SELECT payload FROM vacancy_pool WHERE id = ?');
  const found = new Map<string, UnifiedVacancy>();
  for (const source of cluster.sources) {
    const id = sourceMemberKey(source);
    if (!id || found.has(id)) continue;
    const row = statement.get(id) as { payload: string } | undefined;
    const vacancy = row ? parseVacancy(row.payload) : undefined;
    if (vacancy) found.set(id, vacancy);
  }
  return found;
}

export function parseCluster(json: string): VacancyCluster | undefined {
  try {
    const parsed = JSON.parse(json) as VacancyCluster;
    return parsed && typeof parsed.id === 'string' && Array.isArray(parsed.sources)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

interface DryRunContext {
  readonly db: DatabaseSync;
  readonly referenced: ReadonlyMap<string, string>;
  readonly hasRequirements: boolean;
  readonly counts: ClusterSplitCounts;
}

function countCluster(context: DryRunContext, cluster: VacancyCluster): void {
  const { db, counts } = context;
  if (!hasCrossSourceIdCollision(cluster)) return;
  counts.clustersCollided += 1;
  const pieces = planClusterSplit(cluster, loadMemberVacancies(db, cluster));
  if (pieces.length <= 1) {
    counts.keysRewritten += clusterKeys(cluster).length;
    return;
  }
  if (context.referenced.has(cluster.id)) {
    counts.skippedCandidateRef += 1;
    return;
  }
  counts.clustersSplit += 1;
  counts.piecesCreated += pieces.length - 1;
  for (const piece of pieces) counts.keysRewritten += clusterKeys(piece).length;
  const entry = db
    .prepare('SELECT source_url FROM catalog_entries WHERE cluster_id = ?')
    .get(cluster.id) as { source_url: string } | undefined;
  const holder = entry
    ? pieces.findIndex((piece) => piece.sources.some((s) => s.sourceUrl === entry.source_url))
    : -1;
  if (holder > 0) counts.catalogMoved += 1;
  if (
    context.hasRequirements &&
    db
      .prepare('SELECT 1 FROM vacancy_requirements_cache WHERE cluster_id = ? LIMIT 1')
      .get(cluster.id)
  ) {
    counts.splitWithRequirements += 1;
  }
}

const DRY_RUN_PAGE = 500;

/**
 * Замер разбиения на копии базы (B752): ничего не пишет, читает кластеры
 * страницами по rowid. `limit` — сколько кластеров просмотреть.
 */
export function runClusterSplitDryRun(
  db: DatabaseSync,
  options: { limit?: number } = {},
): ClusterSplitCounts {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const context: DryRunContext = {
    db,
    referenced: candidateReferencedClusters(db),
    hasRequirements: tableExists(db, 'vacancy_requirements_cache'),
    counts: {
      clustersScanned: 0,
      clustersCollided: 0,
      clustersSplit: 0,
      piecesCreated: 0,
      keysRewritten: 0,
      catalogMoved: 0,
      skippedCandidateRef: 0,
      splitWithRequirements: 0,
    },
  };
  const page = db.prepare(
    'SELECT rowid, cluster_json FROM vacancy_clusters WHERE rowid > ? ORDER BY rowid LIMIT ?',
  );
  let cursor = 0;
  while (context.counts.clustersScanned < limit) {
    const size = Math.min(DRY_RUN_PAGE, limit - context.counts.clustersScanned);
    const rows = page.all(cursor, size) as { rowid: number; cluster_json: string }[];
    if (rows.length === 0) break;
    for (const row of rows) {
      context.counts.clustersScanned += 1;
      const cluster = parseCluster(row.cluster_json);
      if (cluster) countCluster(context, cluster);
    }
    cursor = rows[rows.length - 1]!.rowid;
  }
  return context.counts;
}
