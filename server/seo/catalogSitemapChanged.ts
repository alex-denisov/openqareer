import type { DatabaseSync } from 'node:sqlite';
import { readCatalogSitemaps } from './catalogSitemapJob';
import type { SitemapFile } from './sitemapXml';

/**
 * B776 (прод 23.11): веб-процесс каждые 5 минут читал все файлы карт сайта — 14 файлов, 17,6 МБ,
 * 0,6 с цикла событий, — хотя обслуживание пишет их раз в 30 минут. Сначала короткая строка
 * о сборке (без length(xml): он читает весь текст); файлы читаются, только когда она сменилась.
 */
const SIGNATURE_SQL = `SELECT group_concat(name || ':' || url_count || ':' || coalesce(lastmod, '') || ':' || updated_at, '|') AS signature FROM (SELECT * FROM catalog_sitemaps ORDER BY position)`;

export class CatalogSitemapReader {
  private seen: string | null = null;

  /** Новые файлы или null, если сборка та же (или таблицы ещё нет). */
  readIfChanged(database: DatabaseSync): SitemapFile[] | null {
    const exists = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_sitemaps'")
      .get();
    if (!exists) return null;
    const row = database.prepare(SIGNATURE_SQL).get() as { signature: string | null } | undefined;
    const signature = row?.signature ?? null;
    if (!signature || signature === this.seen) return null;
    const files = readCatalogSitemaps(database);
    if (files) this.seen = signature;
    return files;
  }
}
