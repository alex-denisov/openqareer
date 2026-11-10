/**
 * B627: domain, careers page and ATS board for directory companies that only
 * have LinkedIn. The model's answer is a candidate; only what answers over
 * HTTP (the site, the careers page, a board API listing jobs) is written.
 */
import type { DatabaseSync } from 'node:sqlite';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { boardJobs, boardsFromHtml, PROVIDER_NAMES, type BoardCandidate } from './atsBoards';

export interface PendingCompany {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly linkedinUrl: string | null;
}

const answerSchema = z.array(
  z.object({
    key: z.string(),
    website: z.string().nullish(),
    careers: z.string().nullish(),
    ats: z.string().nullish(),
    slug: z.string().nullish(),
  }),
);
export type ModelAnswer = z.infer<typeof answerSchema>[number];

/** The first JSON array in the model text; anything else is an empty answer. */
export function parseModelAnswer(text: string): readonly ModelAnswer[] {
  const match = /\[[\s\S]*\]/.exec(text);
  if (!match) return [];
  try {
    const parsed = answerSchema.safeParse(JSON.parse(match[0]));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function discoveryPrompt(companies: readonly PendingCompany[]): string {
  const list = companies
    .map((c, i) => `${i + 1}. key=${c.companyKey} | name=${c.companyName}${c.linkedinUrl ? ` | linkedin=${c.linkedinUrl}` : ''}`)
    .join('\n');
  return `For each company give its official corporate website, its careers page and the ATS board it uses (greenhouse, lever, ashby, workable, recruitee, smartrecruiters, breezy, pinpoint, personio) with the board slug exactly as in the board URL. Answers are checked by HTTP; use null when unknown.
Return ONLY a JSON array in the same order: {"key":string,"website":string|null,"careers":string|null,"ats":string|null,"slug":string|null}

${list}`;
}

export interface Discovery {
  readonly companyKey: string;
  readonly websiteUrl?: string;
  readonly careersUrl?: string;
  readonly board?: BoardCandidate & { readonly jobs: number };
  readonly evidence: Record<string, unknown>;
}

const LINKEDIN = /linkedin\.com/i;

/** Model-supplied URLs: public DNS names on default ports only, no IP literals or local names. */
export function isPublicHost(url: URL): boolean {
  if (!/^https?:$/.test(url.protocol) || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
}

function absolute(url: string | null | undefined): string | undefined {
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

async function page(url: string, fetchImpl: typeof fetch): Promise<{ status: number; url: string; html: string }> {
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

export async function verifyCompany(
  company: PendingCompany,
  answer: ModelAnswer | undefined,
  fetchImpl: typeof fetch,
  day: string,
): Promise<Discovery> {
  const evidence: Record<string, unknown> = { siteDiscovery: { value: day, how: 'B627 checked' } };
  let websiteUrl: string | undefined;
  let siteHtml = '';
  const site = company.websiteUrl && !LINKEDIN.test(company.websiteUrl) ? undefined : absolute(answer?.website);
  if (site && !LINKEDIN.test(site)) {
    const result = await page(site, fetchImpl);
    if (result.status > 0 && result.status < 400) {
      websiteUrl = `${new URL(result.url).origin}/`;
      siteHtml = result.html;
      evidence.websiteUrl = { value: websiteUrl, how: `B627 model answer, HTTP ${result.status} on ${day}`, confirmed: true };
    }
  }
  let careersUrl: string | undefined;
  let careersHtml = '';
  const careers = absolute(answer?.careers);
  if (careers && !LINKEDIN.test(careers)) {
    const result = await page(careers, fetchImpl);
    if (result.status === 200 && result.html.length > 500) {
      careersUrl = result.url;
      careersHtml = result.html;
      evidence.careersUrl = { value: careersUrl, how: `B627 model answer, HTTP 200 on ${day}`, confirmed: true };
    }
  }
  const candidates: BoardCandidate[] = [];
  const provider = answer?.ats?.toLowerCase();
  if (provider && PROVIDER_NAMES.has(provider) && answer?.slug)
    candidates.push({ provider: provider as BoardCandidate['provider'], slug: answer.slug.trim() });
  candidates.push(...boardsFromHtml(`${careersHtml} ${siteHtml} ${careersUrl ?? ''}`));
  for (const candidate of candidates.slice(0, 6)) {
    const jobs = await boardJobs(candidate, fetchImpl);
    if (jobs > 0) {
      evidence.ats = { value: `${candidate.provider}:${candidate.slug}`, how: `B627 board API returned ${jobs} jobs on ${day}`, confirmed: true };
      return { companyKey: company.companyKey, websiteUrl, careersUrl, board: { ...candidate, jobs }, evidence };
    }
  }
  return { companyKey: company.companyKey, websiteUrl, careersUrl, evidence };
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
}
