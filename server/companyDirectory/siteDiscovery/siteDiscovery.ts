/**
 * B627: domain, careers page and ATS board for directory companies that only
 * have LinkedIn. Candidates come from `deterministicResolver.ts` (B643-9, no
 * model); only what answers over HTTP is written.
 */
import { recordCompanyPlacements } from '../placement/placementWriter';
import type { DatabaseSync } from 'node:sqlite';
import { isPublicHost, resolvesPublic } from '../../connectors/publicHost';
import type { BoardCandidate } from './atsBoards';

export interface PendingCompany {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly linkedinUrl: string | null;
  readonly freehireSlug?: string;
  readonly hasFreehireBoards?: boolean;
  readonly siteSearched?: boolean;
  /** B643: careers page the prune step removed; the resolver never re-adds it. */
  readonly droppedCareersUrl?: string | null;
}

export interface Discovery {
  readonly companyKey: string;
  readonly websiteUrl?: string;
  readonly careersUrl?: string;
  readonly board?: BoardCandidate & { readonly jobs: number };
  /** B643: hh employer ids linked from the home or careers page. */
  readonly hhEmployerIds?: readonly string[];
  readonly evidence: Record<string, unknown>;
}

export const LINKEDIN = /linkedin\.com/i;

export { isPublicHost, resolvesPublic };

export function absolute(url: string | null | undefined): string | undefined {
  const value = url?.trim();
  if (!value) return undefined;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return isPublicHost(url) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A slow company site costs a worker; 8 s keeps the batch moving. */
const PAGE_TIMEOUT_MS = 8_000;
/** Board links sit in the head and nav; scanning more cost event-loop stalls on prod (B643-9). */
const MAX_HTML_CHARS = 200_000;
/** An honest bot name: sites that refuse bots are counted, never bypassed with a browser disguise. */
const PAGE_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; OpenQareerBot/1.0; +https://openqareer.com/)', accept: 'text/html' };

/** Host check before every hop; tests inject one, production always resolves DNS. */
export type HostCheck = (host: string) => Promise<boolean>;

export async function page(
  url: string,
  fetchImpl: typeof fetch,
  hostIsPublic: HostCheck = (host) => resolvesPublic(host),
): Promise<{ status: number; url: string; html: string }> {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const parsed = new URL(current);
      if (!isPublicHost(parsed) || !(await hostIsPublic(parsed.hostname)))
        return { status: 0, url, html: '' };
      const response = await fetchImpl(current, { redirect: 'manual', headers: PAGE_HEADERS, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
      const location = response.headers?.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      const html = (await response.text()).slice(0, MAX_HTML_CHARS);
      return { status: response.status, url: current, html };
    }
    return { status: 0, url, html: '' };
  } catch {
    return { status: 0, url, html: '' };
  }
}

const SITE_NOT_SEARCHED = `(d.evidence IS NULL OR instr(d.evidence, 'B643-9') = 0)`;
/** Unary `+` keeps the planner on the key window: the status and board indexes read the whole directory per page (B761). */
const PENDING_WHERE = `+d.status = 'active' AND +d.ats_provider IS NULL
  AND NOT EXISTS (SELECT 1 FROM company_placement p WHERE p.company_key = d.company_key AND p.type = 'ats')`;

type PendingRow = { company_key: string; company_name: string; website_url: string | null; linkedin_url: string | null; dropped_careers_url: string | null; freehire_slug?: string | null; site_searched: number };
const toPending = (row: PendingRow): PendingCompany => ({
  companyKey: row.company_key,
  companyName: row.company_name,
  websiteUrl: row.website_url,
  linkedinUrl: row.linkedin_url,
  droppedCareersUrl: row.dropped_careers_url,
  ...(row.site_searched ? { siteSearched: true } : {}),
  ...(row.freehire_slug ? { freehireSlug: row.freehire_slug, hasFreehireBoards: true } : {}),
});

/**
 * B643-9: one page of companies with no ATS the deterministic resolver has not
 * looked at, by key. Companies already holding an ATS placement (sources, B645
 * freehire MCP) are skipped. Paging keeps each read short on the 165k directory.
 */
export function readPendingPage(
  database: DatabaseSync,
  afterKey: string,
  limit: number,
  directSince?: number,
  untilKey?: string,
): readonly PendingCompany[] {
  const hasCards = directSince !== undefined &&
    database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='freehire_company_source_candidates'").get();
  const eligible = directSince === undefined ? SITE_NOT_SEARCHED
    : `(${SITE_NOT_SEARCHED} ${hasCards ? 'OR f.slug IS NOT NULL' : ''} OR d.website_url IS NOT NULL)`;
  const directFilter = directSince === undefined ? '' : `AND NOT EXISTS (
    SELECT 1 FROM company_direct_ats_check c WHERE c.company_key = d.company_key AND c.jobs > 0 AND c.checked_at > ?
  )`;
  const rows = database
    .prepare(
      `SELECT d.company_key, d.company_name, d.website_url, d.linkedin_url,
          json_extract(d.evidence, '$.careersUrlDropped.value') AS dropped_careers_url, NOT ${SITE_NOT_SEARCHED} AS site_searched
          ${hasCards ? ', f.slug AS freehire_slug' : ''}
        FROM company_directory d
        ${hasCards ? `LEFT JOIN freehire_company_source_candidates f
          ON f.slug = json_extract(d.evidence, '$.freehire.value')
          AND json_array_length(f.evidence, '$.boards') > 0` : ''}
        WHERE d.company_key > ? AND ${PENDING_WHERE} AND ${eligible} ${directFilter}
          ${untilKey === undefined ? '' : 'AND d.company_key <= ?'} ORDER BY d.company_key LIMIT ?`,
    )
    .all(afterKey, ...(directSince === undefined ? [] : [directSince]), ...(untilKey === undefined ? [] : [untilKey]), limit) as unknown as PendingRow[];
  return rows.map(toPending);
}

/** Last key of the next `size` directory rows; undefined when none are left. */
export function directoryWindowEnd(database: DatabaseSync, afterKey: string, size: number): string | undefined {
  const row = database
    .prepare(
      `SELECT max(company_key) AS last FROM (
         SELECT company_key FROM company_directory WHERE company_key > ? ORDER BY company_key LIMIT ?)`,
    )
    .get(afterKey, size) as { last: string | null };
  return row.last ?? undefined;
}

/** Pool vacancies per company (B643-8 links): the queue order. */
export function vacancyCounts(database: DatabaseSync): ReadonlyMap<string, number> {
  const rows = database
    .prepare(`SELECT company_key, count(*) AS n FROM vacancy_company GROUP BY company_key`)
    .all() as unknown as { company_key: string; n: number }[];
  return new Map(rows.map((row) => [row.company_key, row.n]));
}

/** Whole pending list, most pool vacancies first (tests and one-off reads). */
export function readPendingCompanies(database: DatabaseSync, limit: number): readonly PendingCompany[] {
  const counts = vacancyCounts(database);
  const all: PendingCompany[] = [];
  for (let page = readPendingPage(database, '', 5_000); page.length > 0; page = readPendingPage(database, page.at(-1)!.companyKey, 5_000))
    all.push(...page);
  return orderByVacancies(all, counts).slice(0, limit);
}

export function orderByVacancies(companies: readonly PendingCompany[], counts: ReadonlyMap<string, number>): PendingCompany[] {
  return [...companies].sort((a, b) => (counts.get(b.companyKey) ?? 0) - (counts.get(a.companyKey) ?? 0));
}

/** Idempotent: fills only empty fields; a LinkedIn careers fallback counts as empty. */
export function writeDiscovery(database: DatabaseSync, found: Discovery, now: string): void {
  const sourceType = found.board ? 'ats_direct' : found.careersUrl ? 'corporate_portal' : null;
  database
    .prepare(
      `UPDATE company_directory SET
         website_url = COALESCE(website_url, ?),
         careers_url = CASE WHEN ? IS NOT NULL AND (careers_url IS NULL OR careers_url LIKE '%linkedin.com%') THEN ? ELSE careers_url END,
         ats_slug = CASE WHEN ats_provider IS NULL AND ? IS NOT NULL THEN ? ELSE ats_slug END,
         ats_provider = COALESCE(ats_provider, ?),
         source_type = CASE WHEN source_type = 'linkedin_guest' AND ? IS NOT NULL THEN ? ELSE source_type END,
         evidence = CASE WHEN ? IS NOT NULL AND (careers_url IS NULL OR careers_url LIKE '%linkedin.com%')
           THEN json_set(json_patch(COALESCE(evidence, '{}'), ?), '$.careersUrlSetAt', ?)
           ELSE json_patch(COALESCE(evidence, '{}'), ?) END,
         updated_at = ?
       WHERE company_key = ?`,
    )
    .run(
      found.websiteUrl ?? null,
      found.careersUrl ?? null,
      found.careersUrl ?? null,
      found.board?.slug ?? null,
      found.board?.slug ?? null,
      found.board?.provider ?? null,
      sourceType,
      sourceType,
      found.careersUrl ?? null,
      JSON.stringify(found.evidence),
      now,
      JSON.stringify(found.evidence),
      now,
      found.companyKey,
    );
  // B643-4: the board and the careers site also become the company's placements.
  recordCompanyPlacements(database, found.companyKey, {
    boards: found.board ? [found.board] : [],
    siteUrl: found.careersUrl ?? found.websiteUrl ?? null,
    hhEmployerIds: found.hhEmployerIds ?? [],
    discoveredBy: 'site_discovery',
  }, Date.parse(now) || Date.now());
}
