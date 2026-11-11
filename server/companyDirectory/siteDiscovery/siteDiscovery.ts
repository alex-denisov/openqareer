/**
 * B627: domain, careers page and ATS board for directory companies that only
 * have LinkedIn. Candidates come from `deterministicResolver.ts` (B643-9, no
 * model); only what answers over HTTP is written.
 */
import { recordCompanyPlacements } from '../placement/placementWriter';
import type { DatabaseSync } from 'node:sqlite';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { BoardCandidate } from './atsBoards';

export interface PendingCompany {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly linkedinUrl: string | null;
}

export interface Discovery {
  readonly companyKey: string;
  readonly websiteUrl?: string;
  readonly careersUrl?: string;
  readonly board?: BoardCandidate & { readonly jobs: number };
  readonly evidence: Record<string, unknown>;
}

export const LINKEDIN = /linkedin\.com/i;

/** Candidate URLs: public DNS names on default ports only, no IP literals or local names. */
export function isPublicHost(url: URL): boolean {
  if (!/^https?:$/.test(url.protocol) || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
}

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

const PRIVATE_V4 = /^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./;
/** Every resolved address must be public; DNS errors reject. */
export async function resolvesPublic(host: string, resolve = lookup): Promise<boolean> {
  try {
    const addresses = await resolve(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => {
      const v4 = address.replace(/^::ffff:/i, '');
      if (isIP(v4) === 4) return !PRIVATE_V4.test(v4);
      return !/^(::1?$|f[cd]|fe[89ab])/i.test(address);
    });
  } catch {
    return false;
  }
}

export async function page(url: string, fetchImpl: typeof fetch): Promise<{ status: number; url: string; html: string }> {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const parsed = new URL(current);
      if (!isPublicHost(parsed) || (fetchImpl === fetch && !(await resolvesPublic(parsed.hostname))))
        return { status: 0, url, html: '' };
      const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(12_000) });
      const location = response.headers?.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      const html = (await response.text()).slice(0, 600_000);
      return { status: response.status, url: current, html };
    }
    return { status: 0, url, html: '' };
  } catch {
    return { status: 0, url, html: '' };
  }
}

/** Companies with no ATS that this step has not looked at yet; freehire.me ones (B629) need no model. */
export function readPendingCompanies(database: DatabaseSync, limit: number): readonly PendingCompany[] {
  const rows = database
    .prepare(
      `SELECT company_key, company_name, website_url, linkedin_url FROM company_directory
        WHERE status = 'active' AND ats_provider IS NULL
          AND (evidence IS NULL OR (instr(evidence, 'B627') = 0 AND instr(evidence, 'freehire') = 0 AND instr(evidence, 'B643') = 0))
        ORDER BY created_at DESC, company_key LIMIT ?`,
    )
    .all(limit) as unknown as { company_key: string; company_name: string; website_url: string | null; linkedin_url: string | null }[];
  return rows.map((row) => ({
    companyKey: row.company_key,
    companyName: row.company_name,
    websiteUrl: row.website_url,
    linkedinUrl: row.linkedin_url,
  }));
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
         evidence = json_patch(COALESCE(evidence, '{}'), ?),
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
      JSON.stringify(found.evidence),
      now,
      found.companyKey,
    );
  // B643-4: the board and the careers site also become the company's placements.
  recordCompanyPlacements(database, found.companyKey, {
    boards: found.board ? [found.board] : [],
    siteUrl: found.careersUrl ?? found.websiteUrl ?? null,
    discoveredBy: 'site_discovery',
  }, Date.parse(now) || Date.now());
}
