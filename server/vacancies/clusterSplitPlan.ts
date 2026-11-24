import type { DatabaseSync } from 'node:sqlite';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import {
  hasCrossSourceIdCollision,
  loadMemberVacancies,
  parseCluster,
  planClusterSplit,
} from './clusterSplit';
import { linkOwnersOf, type LinkOwners } from './clusterSplitPages';

/**
 * B752: план шага строится до транзакции записи — чтение пула и сведение
 * кусков (до секунд на склеенный кластер) не держат блокировку записи.
 * В транзакции строка кластера сверяется с той, по которой строился план.
 */

export interface PlannedSplit {
  readonly kind: 'split';
  readonly rowid: number;
  readonly json: string;
  readonly cluster: VacancyCluster;
  /** Основатель первым, затем новые куски. */
  readonly pieces: readonly VacancyCluster[];
  readonly links: LinkOwners;
}

export type PlannedItem =
  | { readonly kind: 'pass'; readonly rowid: number }
  | {
      readonly kind: 'ref';
      readonly rowid: number;
      readonly clusterId: string;
      readonly table: string;
    }
  | PlannedSplit;

interface PlanInput {
  readonly cursor: number;
  readonly chunk: number;
  readonly maxPieces: number;
  readonly referenced: ReadonlyMap<string, string>;
}

/** Последний план большого кластера: части пишутся шаг за шагом без повторного сведения. */
let cachedPlan: PlannedSplit | undefined;

export function planOf(db: DatabaseSync, rowid: number, json: string): PlannedSplit | undefined {
  if (cachedPlan?.rowid === rowid && cachedPlan.json === json) return cachedPlan;
  const cluster = parseCluster(json);
  if (!cluster || !hasCrossSourceIdCollision(cluster)) return undefined;
  const vacancies = loadMemberVacancies(db, cluster);
  const pieces = planClusterSplit(cluster, vacancies);
  if (pieces.length <= 1) return undefined;
  return { kind: 'split', rowid, json, cluster, pieces, links: linkOwnersOf(pieces, vacancies) };
}

/** Большой план запоминается: следующий шаг продолжит его части. */
export function rememberPlan(plan: PlannedSplit): void {
  cachedPlan = plan;
}

function planRow(
  db: DatabaseSync,
  row: { rowid: number; cluster_json: string },
  referenced: ReadonlyMap<string, string>,
): PlannedItem {
  const plan = planOf(db, row.rowid, row.cluster_json);
  if (!plan) return { kind: 'pass', rowid: row.rowid };
  const table = referenced.get(plan.cluster.id);
  return table ? { kind: 'ref', rowid: row.rowid, clusterId: plan.cluster.id, table } : plan;
}

/**
 * Кластеры после курсора по порядку rowid, пока куски плана не заполнят бюджет
 * шага. Большой кластер (кусков больше бюджета) замыкает план.
 */
export function planChunk(db: DatabaseSync, input: PlanInput): PlannedItem[] {
  const rows = db
    .prepare(
      'SELECT rowid, cluster_json FROM vacancy_clusters WHERE rowid > ? ORDER BY rowid LIMIT ?',
    )
    .all(input.cursor, input.chunk) as { rowid: number; cluster_json: string }[];
  const items: PlannedItem[] = [];
  let cost = 0;
  for (const row of rows) {
    const item = planRow(db, row, input.referenced);
    items.push(item);
    if (item.kind !== 'split') continue;
    cost += item.pieces.length;
    if (item.pieces.length > input.maxPieces) rememberPlan(item);
    if (cost >= input.maxPieces) break;
  }
  return items;
}
