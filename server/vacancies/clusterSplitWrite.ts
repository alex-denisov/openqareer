import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import {
  prepareCatalogProjectionStatements,
  writeCatalogEntry,
  type CatalogProjectionStatements,
} from './catalogEntryWriter';
import { CATALOG_CLUSTER_TABLES } from './clusterSplitJournal';
import { tableExists } from './clusterSplit';
import {
  pageOwner,
  recordPageOutcome,
  type LinkOwners,
  type PageOutcome,
  type PublishedPage,
} from './clusterSplitPages';
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

/** Опубликованный адрес ведёт на кусок его вакансии; пустой ключ — страницы у неё нет. */
function redirectPage(
  { db, now }: SplitWriters,
  page: PublishedPage,
  holder: VacancyCluster | undefined,
  stepId: string,
): void {
  const target = holder
    ? (db.prepare('SELECT entry_key FROM catalog_entries WHERE cluster_id = ?').get(holder.id) as
        { entry_key: string } | undefined)
    : undefined;
  db.prepare(
    `INSERT OR REPLACE INTO vacancy_catalog_redirects
       (old_key, old_path, new_cluster_id, new_key, step_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(page.entry_key, page.path, holder?.id ?? '', target?.entry_key ?? '', stepId, now);
}

/**
 * Основатель последним: прежние ключи снимаются, строка и страница каталога
 * переписываются. Прежний адрес остаётся за вакансией, чья ссылка на нём стояла
 * (`pageOwner`): основатель держит его сам, иначе адрес уходит куску либо
 * отвечает как снятый. Запись об адресе идёт до страницы основателя: тот же
 * адрес она занять уже не может (`writeCatalogEntry`).
 * Возвращает итог прежней страницы, `undefined` — страницы не было.
 */
export function writeFounder(
  writers: SplitWriters,
  plan: { readonly pieces: readonly VacancyCluster[]; readonly links: LinkOwners },
  stepId: string,
): PageOutcome | undefined {
  const { db } = writers;
  const founder = plan.pieces[0]!;
  const page = db
    .prepare(
      'SELECT entry_key, path, title, company, source_url FROM catalog_entries WHERE cluster_id = ?',
    )
    .get(founder.id) as PublishedPage | undefined;
  const owner = page ? pageOwner(page, plan.pieces, plan.links) : undefined;
  if (page && owner !== 0) {
    redirectPage(writers, page, owner === undefined ? undefined : plan.pieces[owner], stepId);
  }
  db.prepare('DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?').run(founder.id);
  writeRow(writers, founder);
  writeCatalogEntry(founder, writers.catalog);
  if (!page) return undefined;
  const held = db.prepare('SELECT 1 FROM catalog_entries WHERE cluster_id = ?').get(founder.id);
  // Вакансия у основателя, но её новое имя адреса не даёт: адрес снят, а не забыт.
  if (owner === 0 && !held) redirectPage(writers, page, founder, stepId);
  return recordPageOutcome(db, page, founder.id, stepId);
}
