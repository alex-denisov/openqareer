import type { DatabaseSync } from 'node:sqlite';
import { readCatalogSitemaps } from './catalogSitemapJob';
import type { SitemapFile } from './sitemapXml';

/**
 * B776 (прод 23.11): веб-процесс каждые 5 минут читал все файлы карт сайта — 14 файлов, 17,6 МБ,
 * 0,6 с цикла событий, — хотя обслуживание пишет их раз в 30 минут. Сначала короткая строка
 * о сборке; файлы читаются, только когда она сменилась. Подпись по строкам catalog_sitemaps
 * (база до строки сборки) шла 0,5 с: её столбцы лежат после xml, и чтение шло по всему тексту.
 */
const LEGACY_SIGNATURE_SQL = `SELECT group_concat(name || ':' || url_count || ':' || coalesce(lastmod, '') || ':' || updated_at, '|') AS signature FROM (SELECT name, url_count, lastmod, updated_at FROM catalog_sitemaps ORDER BY position)`;

function tableExists(database: DatabaseSync, name: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function readSignature(database: DatabaseSync): string | null {
  const sql = tableExists(database, 'catalog_sitemaps_build')
    ? 'SELECT signature FROM catalog_sitemaps_build WHERE id = 1'
    : LEGACY_SIGNATURE_SQL;
  const row = database.prepare(sql).get() as { signature: string | null } | undefined;
  return row?.signature ?? null;
}

export class CatalogSitemapReader {
  private seen: string | null = null;

  /** Новые файлы или null, если сборка та же (или таблицы ещё нет). */
  readIfChanged(database: DatabaseSync): SitemapFile[] | null {
    if (!tableExists(database, 'catalog_sitemaps')) return null;
    const signature = readSignature(database);
    if (!signature || signature === this.seen) return null;
    const files = readCatalogSitemaps(database);
    if (files) this.seen = signature;
    return files;
  }
}
