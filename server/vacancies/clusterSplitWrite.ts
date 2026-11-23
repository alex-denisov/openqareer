import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import {
  prepareCatalogProjectionStatements,
  writeCatalogEntry,
  type CatalogProjectionStatements,
} from './catalogEntryWriter';
import { CATALOG_CLUSTER_TABLES } from './clusterSplitJournal';
import { tableExists } from './clusterSplit';
import { clusterKeys, serializeRepresentative } from './vacancyDeduplicator';

/**
 * B752: записи шага разбиения. Куски пишутся до основателя: ключи у
 * `vacancy_cluster_keys` уникальны по (kind, key, cluster_id), так что кусок
 * получает свои ключи, пока основатель ещё держит прежние. Основатель
 * переписывается последним: прежние ключи снимаются, остаются его собственные.
 */

export interface SplitWriters {
  readonly db: DatabaseSync;
  readonly now: number;
  readonly upsert: StatementSync;
  readonly insertKey: StatementSync;
  readonly catalog: CatalogProjectionStatements;
}

export function prepareSplitWriters(db: DatabaseSync, now: number): SplitWriters {
  return {
    db,
    now,
    upsert: db.prepare(
      `INSERT INTO vacancy_clusters (
         id, fingerprint, title, company, cluster_json, items_count, updated_at, representative
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, title = excluded.title,
         company = excluded.company, cluster_json = excluded.cluster_json,
         items_count = excluded.items_count, updated_at = excluded.updated_at,
         representative = excluded.representative`,
    ),
    insertKey: db.prepare(
      'INSERT OR IGNORE INTO vacancy_cluster_keys (kind, key, cluster_id) VALUES (?, ?, ?)',
    ),
    catalog: prepareCatalogProjectionStatements(db),
  };
}

function writeRow(writers: SplitWriters, piece: VacancyCluster): void {
  writers.upsert.run(
    piece.id,
    piece.id,
    piece.canonicalTitle,
    piece.canonicalCompany,
    JSON.stringify(piece),
    piece.vacanciesCount,
    writers.now,
    serializeRepresentative(piece),
  );
  for (const { kind, key } of clusterKeys(piece)) writers.insertKey.run(kind, key, piece.id);
}

/** Кусок (не основатель): строка, ключи и страница каталога. Повтор безвреден. */
export function writePiece(writers: SplitWriters, piece: VacancyCluster): void {
  writeRow(writers, piece);
  writeCatalogEntry(piece, writers.catalog);
}

/** Кусок из прежнего плана, которого нет в новом: строка, ключи и каталог снимаются. */
export function removePiece(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM vacancy_clusters WHERE id = ?').run(id);
  db.prepare('DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?').run(id);
  for (const { table } of CATALOG_CLUSTER_TABLES) {
    if (tableExists(db, table)) db.prepare(`DELETE FROM ${table} WHERE cluster_id = ?`).run(id);
  }
}

interface CatalogEntryRow {
  entry_key: string;
  path: string;
  source_url: string;
}

/**
 * Основатель последним: прежние ключи снимаются, строка и страница каталога
 * переписываются. Старый ключ уходит в переадресацию, только если у основателя
 * страницы больше нет, а ссылка прежней страницы досталась куску.
 * Возвращает, была ли у основателя страница каталога.
 */
export function writeFounder(
  writers: SplitWriters,
  pieces: readonly VacancyCluster[],
  redirectStepId: string,
): boolean {
  const { db } = writers;
  const founder = pieces[0]!;
  const before = db
    .prepare('SELECT entry_key, path, source_url FROM catalog_entries WHERE cluster_id = ?')
    .get(founder.id) as CatalogEntryRow | undefined;
  db.prepare('DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?').run(founder.id);
  writeRow(writers, founder);
  writeCatalogEntry(founder, writers.catalog);
  if (!before) return false;
  if (db.prepare('SELECT 1 FROM catalog_entries WHERE cluster_id = ?').get(founder.id)) return true;
  const holder = pieces.find(
    (piece, index) =>
      index > 0 && piece.sources.some((source) => source.sourceUrl === before.source_url),
  );
  const moved = holder
    ? (db.prepare('SELECT entry_key FROM catalog_entries WHERE cluster_id = ?').get(holder.id) as
        { entry_key: string } | undefined)
    : undefined;
  if (holder && moved) {
    db.prepare(
      `INSERT OR REPLACE INTO vacancy_catalog_redirects
         (old_key, old_path, new_cluster_id, new_key, step_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(before.entry_key, before.path, holder.id, moved.entry_key, redirectStepId, writers.now);
  }
  return true;
}
