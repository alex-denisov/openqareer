import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { catalogEntryRowOfCluster } from './vacancyCatalogProjection';

/**
 * Запись строки каталога по кластеру: одна для пула и для шага разбиения
 * (B752), чтобы кусок получал ту же страницу, что дало бы обслуживание.
 */
export interface CatalogProjectionStatements {
  readonly upsert: { run(...values: SQLInputValue[]): unknown };
  readonly markSeen: { run(...values: SQLInputValue[]): unknown };
  readonly remove: { run(...values: SQLInputValue[]): unknown };
  /** B752: адрес остался за вакансией, уехавшей к другому кластеру. */
  readonly addressGivenAway: { get(...values: SQLInputValue[]): unknown };
}

function prepareAddressGivenAway(db: DatabaseSync) {
  return db.prepare(
    `SELECT 1 FROM vacancy_catalog_redirects
      WHERE old_key = ? AND old_path = ? AND new_cluster_id <> ?`,
  );
}

/**
 * The 32-bit `vacancyKey` of two different clusters can collide (03.11 prod:
 * UNIQUE entry_key aborted a whole Indeed write). The first holder keeps the
 * key, the later cluster is simply not addressable, and the write goes on.
 */
export function prepareCatalogProjectionStatements(db: DatabaseSync): CatalogProjectionStatements {
  const holder = db.prepare(
    'SELECT cluster_id FROM catalog_entries WHERE entry_key = ? AND cluster_id <> ?',
  );
  const statement = db.prepare(
    `INSERT INTO catalog_entries (
     cluster_id, entry_key, path, title, company, location, is_remote,
     salary_label, summary, skills_json, source_url, source_name,
     published_at, last_seen_at, source_count, status,
     place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(cluster_id) DO UPDATE SET
     entry_key = excluded.entry_key,
     path = excluded.path,
     title = excluded.title,
     company = excluded.company,
     location = excluded.location,
     is_remote = excluded.is_remote,
     salary_label = excluded.salary_label,
     summary = excluded.summary,
     skills_json = excluded.skills_json,
     source_url = excluded.source_url,
     source_name = excluded.source_name,
     published_at = excluded.published_at,
     last_seen_at = excluded.last_seen_at,
     source_count = excluded.source_count,
     status = excluded.status,
     place_slug = excluded.place_slug,
     place_label = excluded.place_label,
     role_slug = excluded.role_slug,
     role_label = excluded.role_label,
     published_ms = excluded.published_ms,
     last_seen_ms = excluded.last_seen_ms`,
  );
  return {
    upsert: {
      run: (...values: SQLInputValue[]) => {
        if (holder.get(values[1] as string, values[0] as string)) return undefined;
        return statement.run(...values);
      },
    },
    markSeen: db.prepare(
      `INSERT INTO catalog_entries_seen (cluster_id, processed_at) VALUES (?, ?)
       ON CONFLICT(cluster_id) DO UPDATE SET processed_at = excluded.processed_at`,
    ),
    remove: db.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?'),
    addressGivenAway: prepareAddressGivenAway(db),
  };
}

export function writeCatalogEntry(
  cluster: VacancyCluster,
  statements: CatalogProjectionStatements,
): void {
  const entry = catalogEntryRowOfCluster(cluster);
  if (!entry || statements.addressGivenAway.get(entry.key, entry.path, cluster.id)) {
    // An unaddressable role is intentionally absent from the public catalog,
    // but still marked as inspected so it cannot hold the backfill open.
    statements.remove.run(cluster.id);
    statements.markSeen.run(cluster.id, Date.now());
    return;
  }
  const publishedMs = Date.parse(entry.publishedAt);
  const lastSeenMs = Date.parse(entry.lastSeenAt);
  statements.upsert.run(
    entry.clusterId,
    entry.key,
    entry.path,
    entry.title,
    entry.company,
    entry.location ?? null,
    entry.isRemote ? 1 : 0,
    entry.salaryLabel ?? null,
    entry.summary,
    JSON.stringify(entry.skills),
    entry.sourceUrl,
    entry.sourceName ?? null,
    entry.publishedAt,
    entry.lastSeenAt,
    entry.sourceCount,
    entry.status,
    entry.placeSlug ?? null,
    entry.placeLabel ?? null,
    entry.roleSlug ?? null,
    entry.roleLabel ?? null,
    Number.isFinite(publishedMs) ? publishedMs : 0,
    Number.isFinite(lastSeenMs) ? lastSeenMs : 0,
  );
  statements.markSeen.run(cluster.id, Date.now());
}
