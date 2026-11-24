/**
 * Прод 24.11: с 13.11 (B649-3) карты сайта считались на соединении readOnly, а расчёт пишет
 * историю списков — каждая сборка падала «attempt to write a readonly database». Поток читает
 * своим соединением и пишет своим писателем, короткими транзакциями с зазором; наружу — сводка
 * и адреса строкой JSON на файл (структура из сотен тысяч объектов держала бы цикл событий).
 */
import type { DatabaseSync } from 'node:sqlite';
import { pauseClusterWrite } from '../vacancies/clusterWritePause';
import { snapshotDue, snapshotSitemapCards } from './catalogArchive';
import { computeCatalogSitemaps, writeCatalogSitemaps } from './catalogSitemapJob';
import { nextTurn } from '../data/chunkedRows';
import { safeMessage } from './safeMessage';
import type { SitemapUrl } from './sitemapXml';

export type ArchiveReport =
  { readonly copied: number; readonly ms: number } | { readonly reason: string };

export interface SitemapBuildSummary {
  readonly files: ReadonlyArray<{ readonly name: string; readonly urlCount: number }>;
  readonly urlsJson: readonly string[];
  /** Null: the day's copy is already made. */
  readonly archive: ArchiveReport | null;
}

/** 11.11: today's sitemap cards are copied for their archive pages; never stops the files. */
function archiveCards(
  database: DatabaseSync,
  urls: readonly SitemapUrl[],
  now: Date,
): ArchiveReport | null {
  try {
    if (!snapshotDue(database, now)) return null;
    const started = Date.now();
    const paths = urls.map((url) => url.path);
    const copied = snapshotSitemapCards(database, paths, now, pauseClusterWrite);
    return { copied, ms: Date.now() - started };
  } catch (error: unknown) {
    return { reason: safeMessage(error instanceof Error ? error.message : String(error)) };
  }
}

export function computeAndWriteSitemaps(
  reader: DatabaseSync,
  writer: DatabaseSync,
  now: Date,
  closeReader: () => void = () => undefined,
): SitemapBuildSummary {
  const files = computeCatalogSitemaps(reader, now, writer, pauseClusterWrite);
  closeReader();
  writeCatalogSitemaps(writer, files, now, pauseClusterWrite);
  const urls = files.flatMap((file) => file.urls ?? []);
  return {
    files: files.map(({ name, urlCount }) => ({ name, urlCount })),
    urlsJson: files.map((file) => JSON.stringify(file.urls ?? [])),
    archive: archiveCards(writer, urls, now),
  };
}

/** Главный поток: файл (до 10 тысяч адресов) — свой такт. */
export async function decodeSitemapUrls(urlsJson: readonly string[]): Promise<SitemapUrl[]> {
  const parts: SitemapUrl[][] = [];
  for (const json of urlsJson) {
    parts.push(JSON.parse(json) as SitemapUrl[]);
    await nextTurn();
  }
  return parts.flat();
}
