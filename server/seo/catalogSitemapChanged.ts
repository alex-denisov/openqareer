import type { DatabaseSync } from 'node:sqlite';
import { nextTurn, readRowsChunked } from '../data/chunkedRows';
import { syncSection } from '../observability/syncSections';
import type { SitemapFile } from './sitemapXml';

/**
 * B776 (прод 23.11): веб-процесс каждые 5 минут читал все файлы карт сайта — 14 файлов, 17,6 МБ,
 * 0,6 с цикла событий, — хотя обслуживание пишет их раз в 30 минут. Сначала короткая строка
 * о сборке; файлы читаются, только когда она сменилась. Подпись по строкам catalog_sitemaps
 * (база до строки сборки) шла 0,5 с: её столбцы лежат после xml, и чтение шло по всему тексту.
 */
const LEGACY_SIGNATURE_SQL = `SELECT name || ':' || url_count || ':' || coalesce(lastmod, '') || ':' || updated_at AS signature FROM catalog_sitemaps ORDER BY position`;

/** B702-2: на проде строки сборки нет, и подпись каждые 5 минут шла по 17 МБ: файл — свой такт. */
async function readLegacySignature(database: DatabaseSync): Promise<string | null> {
  const rows = await readRowsChunked<{ signature: string }>(
    database.prepare(LEGACY_SIGNATURE_SQL),
    1,
  );
  return rows.map((row) => row.signature).join('|') || null;
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

async function readSignature(database: DatabaseSync): Promise<string | null> {
  if (!tableExists(database, 'catalog_sitemaps_build')) return readLegacySignature(database);
  const row = database
    .prepare('SELECT signature FROM catalog_sitemaps_build WHERE id = 1')
    .get() as { signature: string | null } | undefined;
  return row?.signature ?? null;
}

interface SitemapRow {
  readonly name: string;
  readonly xml: string;
  readonly url_count: number;
  readonly lastmod: string | null;
}

/**
 * B702 (прод 25.11): 22 файла, 30 МБ, шли одним `.all()` при старте слота и после каждой сборки.
 * Порядок берётся без xml (сортировка по position читала бы весь текст до первой строки), каждый
 * файл — своим тактом, в одной транзакции чтения: файлы одной сборки.
 */
async function readFilesByTurn(database: DatabaseSync): Promise<SitemapFile[] | null> {
  database.exec('BEGIN');
  try {
    const names = database
      .prepare('SELECT name FROM catalog_sitemaps ORDER BY position')
      .all() as unknown as ReadonlyArray<{ name: string }>;
    const one = database.prepare(
      'SELECT name, xml, url_count, lastmod FROM catalog_sitemaps WHERE name = ?',
    );
    const files: SitemapFile[] = [];
    for (const { name } of names) {
      await nextTurn();
      const row = syncSection('sitemap:file', () => one.get(name)) as unknown as SitemapRow;
      files.push({
        name: row.name,
        xml: row.xml,
        urlCount: row.url_count,
        ...(row.lastmod ? { lastmod: row.lastmod } : {}),
      });
    }
    return files.length > 0 ? files : null;
  } finally {
    database.exec('COMMIT');
  }
}

export class CatalogSitemapReader {
  private seen: string | null = null;

  /** Новые файлы или null, если сборка та же (или таблицы ещё нет). */
  async readIfChanged(database: DatabaseSync): Promise<SitemapFile[] | null> {
    if (!tableExists(database, 'catalog_sitemaps')) return null;
    const signature = await readSignature(database);
    if (!signature || signature === this.seen) return null;
    await nextTurn();
    const files = await readFilesByTurn(database);
    if (files) this.seen = signature;
    return files;
  }
}
