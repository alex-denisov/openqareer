/**
 * B763: записи пула без кластера. Сведение в режиме `keyed` идёт после
 * записи; остановка между ними (выкат 23.11 в 00:08Z) оставила 1 534 строки
 * hh без кластера, и сами они туда не попадали. Проход читает пул окнами по
 * `rowid` индекса, без транзакции; кластер есть, когда хотя бы один ключ
 * членства записи уже лежит в `vacancy_cluster_keys`.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { legacyMemberKeyOf, sourceMemberKeys } from './vacancyDeduplicator';

export interface UnclusteredPoolPage {
  readonly inspected: number;
  /** Проекции записей без кластера — вход сведения, как у полной пересборки. */
  readonly unclustered: readonly UnifiedVacancy[];
  /** Курсор после окна; 0 — проход закончен и начнётся сначала. */
  readonly cursor: number;
  readonly passFinished: boolean;
}

const MAX_PAGE_ROWS = 2_000;

/** Ключи, по которым кластер помнит запись: пара площадки, `sourceUrl`, голый id до B752. */
function memberKeysOfRow(vacancy: UnifiedVacancy): string[] {
  const provenance = vacancy.provenance;
  if (!provenance) return [];
  const keys = sourceMemberKeys([provenance]);
  const legacy = legacyMemberKeyOf(vacancy);
  if (legacy) keys.add(legacy);
  return Array.from(keys);
}

export function readUnclusteredPoolPage(
  database: DatabaseSync,
  cursor: number,
  chunk: number,
  parse: (projection: string) => UnifiedVacancy | undefined,
  maxUnclustered = Number.POSITIVE_INFINITY,
): UnclusteredPoolPage {
  const size = Math.max(1, Math.min(Math.trunc(chunk), MAX_PAGE_ROWS));
  const rows = database
    .prepare(
      `SELECT i.rowid AS rowid, c.cluster_json AS projection
         FROM vacancy_pool_index i JOIN vacancy_cluster_input c ON c.id = i.id
        WHERE i.rowid > ? AND i.expired = 0
        ORDER BY i.rowid LIMIT ?`,
    )
    .all(cursor, size) as Array<{ rowid: number; projection: string }>;
  if (rows.length === 0) return { inspected: 0, unclustered: [], cursor: 0, passFinished: true };
  const member = database.prepare(
    "SELECT 1 FROM vacancy_cluster_keys WHERE kind = 'member' AND key = ? LIMIT 1",
  );
  const unclustered: UnifiedVacancy[] = [];
  let inspected = 0;
  for (const row of rows) {
    inspected += 1;
    const vacancy = parse(row.projection);
    if (!vacancy) continue;
    const keys = memberKeysOfRow(vacancy);
    // Без ключей членства нельзя отличить «без кластера» от «в кластере».
    if (keys.length === 0 || keys.some((key) => member.get(key))) continue;
    unclustered.push(vacancy);
    // B763: окно широкое, а сведение за шаг ограничено — остаток окна читается следующим шагом.
    if (unclustered.length >= maxUnclustered) break;
  }
  return {
    inspected,
    unclustered,
    cursor: rows[inspected - 1]!.rowid,
    passFinished: false,
  };
}
