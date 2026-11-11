import type { DatabaseSync } from 'node:sqlite';
import { PLACEMENT_TABLES } from './placementSchema';

/**
 * B643-4 — все подтверждённые размещения компании, а не одно на вид: у
 * справочника один `careers_url` и одна пара ATS, а у компании бывает две-три
 * доски. Размещение, уже принадлежащее другой компании, не переезжает.
 * Приоритеты как в `PLACEMENT_PRIORITY` (сайт 1, ATS 2, агрегатор 4); модель не импортируется,
 * чтобы не замкнуть цикл через `freehireImport`.
 */

export interface CompanyPlacements {
  readonly boards: readonly { readonly provider: string; readonly slug: string }[];
  readonly siteUrl?: string | null;
  /** B643: hh employer ids linked from the company's own pages. */
  readonly hhEmployerIds?: readonly string[];
  readonly discoveredBy: 'freehire' | 'site_discovery';
}

export function placementSiteHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** B643: one id for an hh employer on hh.ru/kz/uz/by — the employer base is shared. */
export const hhEmployerPlacementId = (employerId: string): string => `hh:${employerId}`;

/** Возвращает число записанных строк (новых или получивших компанию). */
export function recordCompanyPlacements(database: DatabaseSync, companyKey: string, found: CompanyPlacements, nowMs: number): number {
  database.exec(PLACEMENT_TABLES);
  const upsert = database.prepare(`INSERT INTO company_placement
      (placement_id, company_key, type, provider, slug, url, priority, discovered_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(placement_id) DO UPDATE SET company_key = excluded.company_key, updated_at = excluded.updated_at
    WHERE company_key IS NULL`);
  let written = 0;
  for (const board of found.boards) {
    const slug = board.slug.toLowerCase();
    written += Number(upsert.run(`ats:${board.provider}:${slug}`, companyKey, 'ats', board.provider, slug, null,
      2, found.discoveredBy, nowMs).changes);
  }
  const host = placementSiteHost(found.siteUrl);
  if (host) {
    written += Number(upsert.run(`site:${host}`, companyKey, 'employer_site', null, null, found.siteUrl ?? null,
      1, found.discoveredBy, nowMs).changes);
  }
  for (const employerId of found.hhEmployerIds ?? []) {
    written += Number(upsert.run(hhEmployerPlacementId(employerId), companyKey, 'aggregator', 'hh', employerId,
      `https://hh.ru/employer/${employerId}`, 4, found.discoveredBy, nowMs).changes);
  }
  return written;
}
