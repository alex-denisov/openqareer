import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { vacancyKey } from '../../shared/vacancyCatalogRoutes';
import { parseVacancy } from './sqliteVacancyPoolStore';
import { clusterKeys, clusterVacancies, sourceMemberKey } from './vacancyDeduplicator';
import { hasCrossSourceIdCollision } from './vacancyIdentity';

export { hasCrossSourceIdCollision };

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
  const founderId = founderOf(cluster);
  // Запись, давшая кластеру id и страницу, могла выпасть из площадок: её кусок остаётся за ней.
  const founderRecord = vacancies.get(founderId);
  if (founderRecord && !members.includes(founderRecord)) members.unshift(founderRecord);
  const rebuilt = clusterVacancies(members);
  if (rebuilt.length <= 1) return [cluster];
  const founderKey = founderRecord ? sourceMemberKey(founderRecord.provenance) : undefined;
  const founderAt = Math.max(
    0,
    rebuilt.findIndex((piece) =>
      piece.sources.some((s) => [founderId, founderKey].includes(sourceMemberKey(s))),
    ),
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
  /** Новые куски этих кластеров: у них нет строки требований, это верх числа задач. */
  piecesWithRequirements: number;
  /** Переезды страниц, по которым шаг запишет переадресацию (ключ свободен, адрес с ключом). */
  redirects: number;
  /** Примерный объём журнала: строка кластера, его ключи и строка каталога, байты. */
  journalBytesEstimate: number;
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
  const statement = db.prepare('SELECT payload, expired_at FROM vacancy_pool WHERE id = ?');
  const found = new Map<string, UnifiedVacancy>();
  for (const source of cluster.sources) {
    const id = sourceMemberKey(source);
    if (!id || found.has(id)) continue;
    const row = statement.get(id) as { payload: string } | undefined;
    const vacancy = row ? parseVacancy(row.payload) : undefined;
    if (vacancy) found.set(id, vacancy);
  }
  addFounderRecord(statement, cluster, found);
  return found;
}

/**
 * Живая запись основателя, чья ссылка стоит на карточке кластера, даже когда её нет в
 * площадках или её id в пуле другой («dou-x-1» против «dou-x:1»): иначе id кластера и
 * страница достаются чужому куску (25.11: 12 живых страниц ушли в снятые).
 */
function addFounderRecord(
  statement: StatementSync,
  cluster: VacancyCluster,
  found: Map<string, UnifiedVacancy>,
): void {
  const id = founderOf(cluster);
  if (found.has(id)) return;
  const row = statement.get(id) as { payload: string; expired_at: string | null } | undefined;
  const vacancy = row && !row.expired_at ? parseVacancy(row.payload) : undefined;
  if (!vacancy || vacancy.status !== 'active' || vacancy.url !== cluster.primaryUrl) return;
  found.set(id, vacancy);
  const key = sourceMemberKey(vacancy.provenance);
  if (key && !found.has(key)) found.set(key, vacancy);
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

interface CatalogRowForCount {
  entry_key: string;
  path: string;
  source_url: string;
}

/** Переезд страницы и объём журнала — по тем же правилам, что у шага разбиения. */
function countCatalog(
  context: DryRunContext,
  cluster: VacancyCluster,
  pieces: readonly VacancyCluster[],
): void {
  const { db, counts } = context;
  const entry = db.prepare('SELECT * FROM catalog_entries WHERE cluster_id = ?').get(cluster.id) as
    CatalogRowForCount | undefined;
  counts.journalBytesEstimate +=
    Buffer.byteLength(JSON.stringify(cluster)) * 2 +
    Buffer.byteLength(JSON.stringify(clusterKeys(cluster))) +
    (entry ? Buffer.byteLength(JSON.stringify(entry)) : 0);
  if (!entry) return;
  const holder = pieces.findIndex((piece) =>
    piece.sources.some((source) => source.sourceUrl === entry.source_url),
  );
  if (holder <= 0) return;
  counts.catalogMoved += 1;
  const newKey = vacancyKey(pieces[holder]!.id);
  const taken = db.prepare('SELECT 1 FROM catalog_entries WHERE entry_key = ?').get(newKey);
  if (!taken && entry.path.endsWith(`-${entry.entry_key}`)) counts.redirects += 1;
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
  countCatalog(context, cluster, pieces);
  if (
    context.hasRequirements &&
    db
      .prepare('SELECT 1 FROM vacancy_requirements_cache WHERE vacancy_id = ? LIMIT 1')
      .get(cluster.id)
  ) {
    counts.splitWithRequirements += 1;
    counts.piecesWithRequirements += pieces.length - 1;
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
      piecesWithRequirements: 0,
      redirects: 0,
      journalBytesEstimate: 0,
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
