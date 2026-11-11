/**
 * Rules every sitemap URL must pass (owner, 11.11): 200 without redirect,
 * no noindex (meta or header), self canonical, not blocked by robots.txt,
 * no query or /page/N. Pure functions, shared by the daily check in the
 * maintenance process (`sitemapHealth.ts`) and `scripts/seo/verify-sitemap.mjs`,
 * which imports this file directly (Node strips the types), so it keeps to
 * erasable TypeScript and has no imports.
 */

export interface FetchedPage {
  readonly url: string;
  readonly status: number;
  readonly location?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
  readonly html?: string;
}

export function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) =>
    (m[1] ?? '').replace(/&amp;/g, '&'),
  );
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/.test(xml);
}

/** Disallow prefixes for `User-agent: *` (the group Googlebot falls back to). */
export function parseRobotsDisallow(text: string, agent = '*'): string[] {
  const rules: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
    } else if (key === 'disallow' || key === 'allow') {
      inRules = true;
      if (key === 'disallow' && value && agents.includes(agent.toLowerCase())) rules.push(value);
    }
  }
  return rules;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3] ?? '') : null;
}

function headTags(html: string, tagName: string): string[] {
  const head = html.split(/<\/head>/i)[0] ?? '';
  return [...head.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
}

/** One message per violated rule; empty = clean. */
export function checkUrl(page: FetchedPage, disallow: readonly string[] = []): string[] {
  const { url, status, location, headers = {}, html = '' } = page;
  const problems: string[] = [];
  const parsed = new URL(url);
  if (parsed.search) problems.push('query in URL');
  if (/\/page\/\d+/.test(parsed.pathname)) problems.push('/page/N in URL');
  if (disallow.some((rule) => parsed.pathname.startsWith(rule)))
    problems.push('blocked by robots.txt');
  if (status !== 200) {
    problems.push(`status ${status}${location ? ` → ${location}` : ''}`);
    return problems;
  }
  const xrt = String(headers['x-robots-tag'] ?? '');
  if (/noindex/i.test(xrt)) problems.push(`X-Robots-Tag: ${xrt}`);
  for (const tag of headTags(html, 'meta')) {
    const name = (attr(tag, 'name') ?? '').toLowerCase();
    if (
      (name === 'robots' || name === 'googlebot') &&
      /noindex/i.test(attr(tag, 'content') ?? '')
    ) {
      problems.push(`meta ${name} noindex`);
    }
  }
  const canonicals = headTags(html, 'link')
    .filter((tag) => (attr(tag, 'rel') ?? '').toLowerCase() === 'canonical')
    .map((tag) => attr(tag, 'href'));
  if (canonicals.length === 0) problems.push('no canonical');
  else if (canonicals.length > 1) problems.push(`${canonicals.length} canonicals`);
  else if (canonicals[0] !== url) problems.push(`canonical → ${canonicals[0]}`);
  return problems;
}
