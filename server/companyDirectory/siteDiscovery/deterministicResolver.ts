/**
 * B643-9: company site, careers page and ATS board without a model (owner
 * decision 11.11). Candidates: the site already in the directory, its usual
 * careers paths, ATS links on those pages, then name slugs on board APIs.
 * Only what answers over HTTP is kept.
 */
import { boardJobs, boardsFromHtml, type BoardCandidate, type DiscoveredProvider } from './atsBoards';
import { absolute, LINKEDIN, page, type Discovery, type PendingCompany } from './siteDiscovery';

const CAREERS_PATHS = ['/careers', '/jobs'] as const;
/** Providers with a slug-addressed public API that answers 404 for unknown slugs. */
const GUESS_PROVIDERS: readonly DiscoveredProvider[] = ['greenhouse', 'lever', 'ashby', 'workable'];
const LEGAL = /^(inc|llc|ltd|limited|gmbh|ag|sa|sas|bv|nv|plc|corp|corporation|co|company|oy|ab|as|srl|spa|ooo|zao|pjsc|group|holding|holdings)$/;
const MIN_SLUG = 4;
const MAX_CANDIDATES = 6;

/** Board slugs from the company name: joined and hyphenated, legal suffixes dropped. */
export function nameSlugs(name: string): readonly string[] {
  const words = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !LEGAL.test(w));
  const joined = words.join('');
  if (joined.length < MIN_SLUG) return [];
  return words.length > 1 ? [joined, words.join('-')] : [joined];
}

async function readSite(company: PendingCompany, fetchImpl: typeof fetch, day: string, evidence: Record<string, unknown>) {
  const site = company.websiteUrl && !LINKEDIN.test(company.websiteUrl) ? absolute(company.websiteUrl) : undefined;
  if (!site) return { html: '' } as { html: string; careersUrl?: string; careersHtml?: string };
  const home = await page(site, fetchImpl);
  if (home.status === 0 || home.status >= 400) return { html: '' };
  const origin = new URL(home.url).origin;
  for (const path of CAREERS_PATHS) {
    const result = await page(`${origin}${path}`, fetchImpl);
    if (result.status === 200 && result.html.length > 500) {
      evidence.careersUrl = { value: result.url, how: `B643-9 site path ${path}, HTTP 200 on ${day}`, confirmed: true };
      return { html: home.html, careersUrl: result.url, careersHtml: result.html };
    }
  }
  return { html: home.html };
}

/** Joined slug at every provider; the hyphenated one only where boards use hyphens (lever, ashby). */
function guesses(name: string): readonly BoardCandidate[] {
  const [joined, hyphenated] = nameSlugs(name);
  if (!joined) return [];
  const all: BoardCandidate[] = GUESS_PROVIDERS.map((provider) => ({ provider, slug: joined }));
  if (hyphenated) all.push({ provider: 'lever', slug: hyphenated }, { provider: 'ashby', slug: hyphenated });
  return all;
}

export async function resolveCompany(company: PendingCompany, fetchImpl: typeof fetch, day: string): Promise<Discovery> {
  const evidence: Record<string, unknown> = { siteDiscovery: { value: day, how: 'B643-9 checked without model' } };
  const site = await readSite(company, fetchImpl, day, evidence);
  const linked = boardsFromHtml(`${site.careersHtml ?? ''} ${site.html} ${site.careersUrl ?? ''}`).slice(0, MAX_CANDIDATES);
  for (const candidate of linked) {
    const jobs = await boardJobs(candidate, fetchImpl);
    if (jobs > 0) {
      evidence.ats = { value: `${candidate.provider}:${candidate.slug}`, how: `B643-9 link on company pages, board API returned ${jobs} jobs on ${day}`, confirmed: true };
      return { companyKey: company.companyKey, careersUrl: site.careersUrl, board: { ...candidate, jobs }, evidence };
    }
  }
  // Name slugs: every guess is asked; boards at two providers mean the name is not unique enough.
  const answered: (BoardCandidate & { jobs: number })[] = [];
  for (const candidate of guesses(company.companyName)) {
    const jobs = await boardJobs(candidate, fetchImpl);
    if (jobs > 0 && !answered.some((a) => a.provider === candidate.provider)) answered.push({ ...candidate, jobs });
  }
  if (answered.length > 1) {
    evidence.atsAmbiguous = { value: answered.map((a) => `${a.provider}:${a.slug}`), how: `B643-9 name slug answered at several providers on ${day}` };
  } else if (answered[0]) {
    const board = answered[0];
    evidence.ats = { value: `${board.provider}:${board.slug}`, how: `B643-9 name slug, board API returned ${board.jobs} jobs on ${day}`, confirmed: false };
    return { companyKey: company.companyKey, careersUrl: site.careersUrl, board, evidence };
  }
  return { companyKey: company.companyKey, careersUrl: site.careersUrl, evidence };
}
