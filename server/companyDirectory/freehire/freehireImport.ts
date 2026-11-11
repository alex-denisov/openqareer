/**
 * B641: companies, their sites and ATS boards from the open freehire.me API into
 * company_directory. Vacancies are not imported: the job links only tell which
 * board a company uses. A board counts when its slug belongs to the company and,
 * where the provider has a public API, that API lists jobs.
 */
import type { DatabaseSync } from 'node:sqlite';
import { boardBelongsToCompany } from '../../vacancies/corporateSourceQuality';
import { boardJobs, PROVIDER_NAMES, type DiscoveredProvider } from '../siteDiscovery/atsBoards';
import { isPublicHost } from '../siteDiscovery/siteDiscovery';
import type { FreehireCompanyCard } from './freehireClient';
import { recordCompanyPlacements } from '../placement/placementWriter';

export interface FoundBoard {
  readonly provider: string;
  readonly slug: string;
}

const JOB_URL_BOARDS: readonly [RegExp, string][] = [
  [/^https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)/i, 'greenhouse'],
  [/^https?:\/\/jobs(?:\.eu)?\.lever\.co\/([\w.-]+)/i, 'lever'],
  [/^https?:\/\/jobs\.ashbyhq\.com\/([\w.-]+)/i, 'ashby'],
  [/^https?:\/\/apply\.workable\.com\/(?!j\/)([\w-]+)/i, 'workable'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.recruitee\.com/i, 'recruitee'],
  [/^https?:\/\/(?:careers|jobs)\.smartrecruiters\.com\/([\w-]+)/i, 'smartrecruiters'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.breezy\.hr/i, 'breezy'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.pinpointhq\.com/i, 'pinpoint'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.jobs\.personio\.(?:de|com)/i, 'personio'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.bamboohr\.com/i, 'bamboohr'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.teamtailor\.com/i, 'teamtailor'],
];
const WORKDAY = /^https?:\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/i;
const NOT_A_SLUG = /^(embed|api|www|jobs|careers|app|j|v1|job|search)$/i;

/** Board of one job link; workday keeps the directory's tenant/wdN/site form. */
export function boardFromJobUrl(url: string): FoundBoard | null {
  const workday = WORKDAY.exec(url);
  if (workday) return { provider: 'workday', slug: `${workday[1]}/${workday[2]}/${workday[3]}`.toLowerCase() };
  for (const [pattern, provider] of JOB_URL_BOARDS) {
    const slug = pattern.exec(url)?.[1];
    if (slug && !NOT_A_SLUG.test(slug)) return { provider, slug: slug.toLowerCase() };
  }
  return null;
}

/** Distinct boards from the job links, most frequent first. */
export function boardsOfCard(card: FreehireCompanyCard): readonly FoundBoard[] {
  const counts = new Map<string, { board: FoundBoard; n: number }>();
  for (const job of card.jobs) {
    const board = boardFromJobUrl(job.url);
    if (!board) continue;
    const id = `${board.provider}:${board.slug}`;
    counts.set(id, { board, n: (counts.get(id)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.board);
}

const NOT_A_COMPANY_SITE =
  /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|t\.me|freehire\.me|indeed\.com|glassdoor\.com|hh\.ru|wellfound\.com|crunchbase\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|myworkdayjobs\.com|smartrecruiters\.com|google\.com|wikipedia\.org)$/i;

/** Company homepage origin, or null for anything that is not a public company site. */
export function cleanWebsite(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!isPublicHost(url) || NOT_A_COMPANY_SITE.test(url.hostname)) return null;
    return `${url.origin}/`;
  } catch {
    return null;
  }
}

export function hostRoot(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
  } catch {
    return '';
  }
}

const LEGAL_SUFFIX = /\b(inc|llc|ltd|limited|gmbh|ag|sa|sas|bv|corp|corporation|co|plc|oy|ab|as|srl|spa|pty|group|holdings?)\b\.?/g;

/** Normalized name for matching: «Agoda Company Pte. Ltd.» and «agoda» meet. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

export interface DirectoryIndex {
  readonly byKey: Map<string, string>;
  readonly byName: Map<string, string>;
  readonly byDomain: Map<string, string>;
  readonly byBoard: Map<string, string>;
  readonly rows: Map<string, { website: string | null; atsProvider: string | null; sourceType: string }>;
}

export function loadDirectoryIndex(database: DatabaseSync): DirectoryIndex {
  const rows = database
    .prepare(
      `SELECT company_key, company_name, website_url, careers_url, ats_provider, ats_slug, source_type FROM company_directory`,
    )
    .all() as unknown as {
    company_key: string;
    company_name: string;
    website_url: string | null;
    careers_url: string | null;
    ats_provider: string | null;
    ats_slug: string | null;
    source_type: string;
  }[];
  const index: DirectoryIndex = { byKey: new Map(), byName: new Map(), byDomain: new Map(), byBoard: new Map(), rows: new Map() };
  for (const row of rows) remember(index, row.company_key, row.company_name, row.website_url, row.ats_provider, row.ats_slug, row.source_type);
  return index;
}

function remember(
  index: DirectoryIndex,
  key: string,
  name: string,
  website: string | null,
  provider: string | null,
  slug: string | null,
  sourceType: string,
): void {
  index.byKey.set(key, key);
  const byName = nameKey(name);
  if (byName && !index.byName.has(byName)) index.byName.set(byName, key);
  const domain = hostRoot(website);
  if (domain && !index.byDomain.has(domain)) index.byDomain.set(domain, key);
  if (provider && slug) index.byBoard.set(`${provider}:${slug.toLowerCase()}`, key);
  index.rows.set(key, { website, atsProvider: provider, sourceType });
}

export function matchCompany(
  index: DirectoryIndex,
  card: FreehireCompanyCard,
  website: string | null,
  boards: readonly FoundBoard[],
): string | undefined {
  for (const board of boards) {
    const hit = index.byBoard.get(`${board.provider}:${board.slug}`);
    if (hit) return hit;
  }
  const domain = hostRoot(website);
  return (
    (domain ? index.byDomain.get(domain) : undefined) ??
    index.byKey.get(card.slug) ??
    index.byName.get(nameKey(card.name)) ??
    index.byKey.get(nameKey(card.name))
  );
}

export type BoardCheck = (board: FoundBoard) => Promise<number>;

/** Public API job count where the provider has one; boards without it stay unconfirmed. */
export function boardCheck(fetchImpl: typeof fetch): BoardCheck {
  return async (board) =>
    PROVIDER_NAMES.has(board.provider)
      ? boardJobs({ provider: board.provider as DiscoveredProvider, slug: board.slug }, fetchImpl)
      : 0;
}

export interface ImportOutcome {
  readonly companyKey: string;
  readonly isNew: boolean;
  readonly websiteAdded: boolean;
  readonly board: FoundBoard | null;
}

/** Boards (of the first three) that belong to the company and are not dead, most frequent first. */
async function liveBoards(
  card: FreehireCompanyCard,
  website: string | null,
  boards: readonly FoundBoard[],
  check: BoardCheck,
): Promise<readonly { board: FoundBoard; jobs: number }[]> {
  const hints = [card.name, card.slug, hostRoot(website).split('.')[0] ?? ''].filter(Boolean);
  const live: { board: FoundBoard; jobs: number }[] = [];
  for (const board of boards.slice(0, 3)) {
    if (isAggregator(board.slug)) continue;
    const flat = board.slug.split('/')[0]!.replace(/[^a-z0-9]/g, '');
    if (!boardBelongsToCompany(flat, hints)) continue;
    const jobs = await check(board);
    if (jobs !== -1) live.push({ board, jobs });
  }
  return live;
}

/**
 * Job aggregators publish many employers' jobs on one board (Jobgether had 4 010
 * on lever on 10.11): not a company's own ATS, so neither the board nor the company is kept.
 */
const AGGREGATOR = /jobgether|jobsbridge|worksterjobs|workster-jobs|^jobs-?for-|jooble|remoteok|remotive|talent-?com$|jobleads|jobright|lensa|ziprecruiter|careerbuilder|monster|adzuna|simplyhired/i;

export function isAggregator(nameOrSlug: string): boolean {
  return AGGREGATOR.test(nameOrSlug.toLowerCase().replace(/\s+/g, '-'));
}

/** Aggregator boards already imported from freehire become dormant; returns how many. */
export function disableAggregatorBoards(database: DatabaseSync, now: Date): number {
  const rows = database
    .prepare(
      `SELECT company_key, company_name, ats_slug FROM company_directory
        WHERE status = 'active' AND json_extract(evidence, '$.freehire') IS NOT NULL AND ats_slug IS NOT NULL`,
    )
    .all() as unknown as { company_key: string; company_name: string; ats_slug: string }[];
  const keys = rows.filter((r) => isAggregator(r.company_name) || isAggregator(r.ats_slug) || isAggregator(r.company_key)).map((r) => r.company_key);
  const update = database.prepare(
    `UPDATE company_directory SET status = 'dormant', updated_at = ?,
       evidence = json_patch(COALESCE(evidence, '{}'), '{"dormant":{"value":"aggregator","how":"B641 job aggregator board, not an employer"}}')
     WHERE company_key = ?`,
  );
  for (const key of keys) update.run(now.toISOString(), key);
  return keys.length;
}

/** «jobs.compassgroupcareers.com», «jpmc-dev9-fa-oraclecloud-com-cx»: a job host, not a company. */
const HOST_LIKE = /\.(com|net|org|io)(\.|$)|oraclecloud|jibeapply|jobline/i;

/** Writes one freehire company: insert when new, else fill only empty fields. */
export async function importCompany(
  database: DatabaseSync,
  index: DirectoryIndex,
  card: FreehireCompanyCard,
  check: BoardCheck,
  now: Date,
): Promise<ImportOutcome | null> {
  const name = card.name.trim();
  if (name.length < 2 || name.length > 160 || HOST_LIKE.test(name) || HOST_LIKE.test(card.slug.replace(/-/g, '.')) || isAggregator(name) || isAggregator(card.slug)) return null;
  const website = cleanWebsite(card.website);
  const boards = boardsOfCard(card);
  const day = now.toISOString().slice(0, 10);
  const live = await liveBoards(card, website, boards, check);
  const picked = live[0] ?? null;
  const evidence: Record<string, unknown> = { freehire: { value: card.slug, how: `freehire.me API on ${day}` } };
  if (website) evidence.websiteUrl = { value: website, how: 'freehire company_info.website' };
  if (picked)
    evidence.ats = {
      value: `${picked.board.provider}:${picked.board.slug}`,
      how: picked.jobs > 0 ? `freehire job link; board API returned ${picked.jobs} jobs on ${day}` : 'freehire job link; provider has no public API check',
      confirmed: picked.jobs > 0,
    };
  const existing = matchCompany(index, card, website, boards);
  const stamp = now.toISOString();
  if (!existing) {
    const key = index.byKey.has(card.slug) ? `${card.slug}-freehire` : card.slug;
    const sourceType = picked ? 'ats_direct' : website ? 'corporate_portal' : 'linkedin_guest';
    database
      .prepare(
        `INSERT INTO company_directory (company_key, company_name, website_url, source_type, ats_provider, ats_slug,
           status, created_at, updated_at, evidence) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT(company_key) DO NOTHING`,
      )
      .run(key, name, website, sourceType, picked?.board.provider ?? null, picked?.board.slug ?? null, stamp, stamp, JSON.stringify(evidence));
    remember(index, key, name, website, picked?.board.provider ?? null, picked?.board.slug ?? null, sourceType);
    recordFreehirePlacements(database, key, live, website, now);
    return { companyKey: key, isNew: true, websiteAdded: Boolean(website), board: picked?.board ?? null };
  }
  recordFreehirePlacements(database, existing, live, website, now);
  return updateExisting(database, index, existing, name, website, picked?.board ?? null, evidence, stamp);
}

/** B643-4: every live board and the site go to `company_placement`, not only the first one. */
function recordFreehirePlacements(
  database: DatabaseSync,
  companyKey: string,
  live: readonly { board: FoundBoard }[],
  website: string | null,
  now: Date,
): void {
  recordCompanyPlacements(database, companyKey, { boards: live.map(({ board }) => board), siteUrl: website, discoveredBy: 'freehire' }, now.getTime());
}

function updateExisting(
  database: DatabaseSync,
  index: DirectoryIndex,
  existing: string,
  name: string,
  website: string | null,
  pickedBoard: FoundBoard | null,
  evidence: Record<string, unknown>,
  stamp: string,
): ImportOutcome {
  const row = index.rows.get(existing);
  const websiteAdded = Boolean(website && !row?.website);
  const boardAdded = Boolean(pickedBoard && !row?.atsProvider);
  const sourceType = boardAdded ? 'ats_direct' : websiteAdded && row?.sourceType === 'linkedin_guest' ? 'corporate_portal' : null;
  database
    .prepare(
      `UPDATE company_directory SET
         website_url = COALESCE(website_url, ?),
         ats_slug = CASE WHEN ats_provider IS NULL AND ? IS NOT NULL THEN ? ELSE ats_slug END,
         ats_provider = COALESCE(ats_provider, ?),
         source_type = CASE WHEN ? IS NOT NULL AND source_type <> 'ats_direct' THEN ? ELSE source_type END,
         evidence = json_patch(COALESCE(evidence, '{}'), ?),
         updated_at = ?
       WHERE company_key = ?`,
    )
    .run(
      websiteAdded ? website : null,
      boardAdded ? pickedBoard!.slug : null,
      boardAdded ? pickedBoard!.slug : null,
      boardAdded ? pickedBoard!.provider : null,
      sourceType,
      sourceType,
      JSON.stringify({ freehire: evidence.freehire, ...(websiteAdded ? { websiteUrl: evidence.websiteUrl } : {}), ...(boardAdded ? { ats: evidence.ats } : {}) }),
      stamp,
      existing,
    );
  if (websiteAdded || boardAdded)
    remember(index, existing, name, row?.website ?? website, row?.atsProvider ?? pickedBoard?.provider ?? null, boardAdded ? pickedBoard!.slug : null, sourceType ?? row?.sourceType ?? '');
  return { companyKey: existing, isNew: false, websiteAdded, board: boardAdded ? pickedBoard! : null };
}
