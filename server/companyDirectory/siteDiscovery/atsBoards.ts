/**
 * B627: ATS boards of a company — found as links on its own pages, checked by
 * the provider's public API. A board counts only when the API lists jobs.
 */
export type DiscoveredProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workable'
  | 'recruitee'
  | 'smartrecruiters'
  | 'breezy'
  | 'pinpoint'
  | 'personio'
  | 'bamboohr'
  | 'teamtailor';

export interface BoardCandidate {
  readonly provider: DiscoveredProvider;
  readonly slug: string;
}

/**
 * B646: hosts and reserved labels follow freehire `internal/ingest/atsboard`
 * (MIT, Copyright (c) 2026 freehire contributors, see NOTICE) for the providers we poll.
 * The third item prefixes the slug the way our adapter addresses the board.
 */
const LINK_PATTERNS: readonly (readonly [RegExp, DiscoveredProvider, string?])[] = [
  [/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([\w-]+)/gi, 'greenhouse'],
  [/boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/gi, 'greenhouse'],
  [/jobs\.lever\.co\/([\w.-]+)/gi, 'lever'],
  [/jobs\.eu\.lever\.co\/([\w.-]+)/gi, 'lever', 'eu-'],
  [/jobs\.ashbyhq\.com\/([\w.-]+)/gi, 'ashby'],
  [/apply\.workable\.com\/([\w-]+)/gi, 'workable'],
  [/([\w-]+)\.recruitee\.com/gi, 'recruitee'],
  [/(?:careers|jobs)\.smartrecruiters\.com\/oneclick-ui\/company\/([\w-]+)/gi, 'smartrecruiters'],
  [/(?:careers|jobs)\.smartrecruiters\.com\/([\w-]+)/gi, 'smartrecruiters'],
  // B643-9: the job-alerts widget names the company only in `dcr_ci` (Smiths Group).
  [/smartrecruiters\.com\/widget\/[^"'\s]*?dcr_ci=([\w-]+)/gi, 'smartrecruiters'],
  [/([\w-]+)\.breezy\.hr/gi, 'breezy'],
  [/([\w-]+)\.pinpointhq\.com/gi, 'pinpoint'],
  [/([\w-]+)\.jobs\.personio\.(?:de|com)/gi, 'personio'],
  [/([\w-]+)\.bamboohr\.com/gi, 'bamboohr'],
  [/([\w-]+)\.teamtailor\.com/gi, 'teamtailor'],
];
// Platform's own hosts and paths, never a tenant (freehire board_platform.go platformLabels).
const NOT_A_SLUG =
  /^(embed|api|www|jobs|careers|app|static|assets|js|css|v1|search|widget|job_board|cdn|oneclick-ui|dashboard|admin|support|help|blog|docs|tt)$/i;
const MAX_CANDIDATES = 6;

export const PROVIDER_NAMES: ReadonlySet<string> = new Set(LINK_PATTERNS.map(([, p]) => p));

/** Boards linked from page HTML, first seen first, without duplicates. */
export function boardsFromHtml(html: string): readonly BoardCandidate[] {
  const found: BoardCandidate[] = [];
  for (const [pattern, provider, prefix = ''] of LINK_PATTERNS) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[1] ?? '';
      if (!raw || NOT_A_SLUG.test(raw)) continue;
      const slug = `${prefix}${raw}`;
      if (found.some((c) => c.provider === provider && c.slug.toLowerCase() === slug.toLowerCase()))
        continue;
      found.push({ provider, slug });
    }
  }
  return found.slice(0, MAX_CANDIDATES);
}

const SLUG = /^[\w.-]{2,80}$/;

function boardApi(candidate: BoardCandidate): string {
  const s = encodeURIComponent(candidate.slug);
  switch (candidate.provider) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`;
    case 'lever':
      return candidate.slug.startsWith('eu-')
        ? `https://api.eu.lever.co/v0/postings/${encodeURIComponent(candidate.slug.slice(3))}?mode=json&limit=200`
        : `https://api.lever.co/v0/postings/${s}?mode=json&limit=200`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
    case 'workable':
      return `https://apply.workable.com/api/v1/widget/accounts/${s}`;
    case 'recruitee':
      return `https://${s}.recruitee.com/api/offers/`;
    case 'smartrecruiters':
      return `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=10`;
    case 'breezy':
      return `https://${s}.breezy.hr/json`;
    case 'pinpoint':
      return `https://${s}.pinpointhq.com/postings.json`;
    case 'personio':
      return `https://${s}.jobs.personio.de/xml`;
    case 'bamboohr':
      return `https://${s}.bamboohr.com/careers/list`;
    case 'teamtailor':
      return `https://${s}.teamtailor.com/jobs.rss`;
  }
}

/** Number of jobs the board's API lists; -1 when the board does not answer. */
export function countJobs(provider: DiscoveredProvider, body: string): number {
  if (provider === 'personio') return (body.match(/<position>/g) ?? []).length;
  if (provider === 'teamtailor') return body.includes('<rss') ? (body.match(/<item>/g) ?? []).length : -1;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return -1;
  }
  if (Array.isArray(parsed)) return provider === 'lever' || provider === 'breezy' ? parsed.length : -1;
  const record = (parsed ?? {}) as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(record[key]) ? (record[key] as unknown[]).length : -1);
  if (provider === 'recruitee') return list('offers');
  if (provider === 'bamboohr') return list('result');
  if (provider === 'pinpoint') return list('data');
  if (provider === 'smartrecruiters')
    return typeof record.totalFound === 'number' ? record.totalFound : -1;
  return list('jobs');
}

export async function boardJobs(
  candidate: BoardCandidate,
  fetchImpl: typeof fetch,
  timeoutMs = 12_000,
): Promise<number> {
  if (!SLUG.test(candidate.slug)) return -1;
  try {
    const response = await fetchImpl(boardApi(candidate), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) return -1;
    return countJobs(candidate.provider, await response.text());
  } catch {
    return -1;
  }
}
