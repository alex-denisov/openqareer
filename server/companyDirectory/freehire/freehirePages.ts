/**
 * B645: companies from freehire.me public pages instead of the quota-bound API.
 * The sitemap lists every company page (10 000 per shard); each page's SvelteKit
 * data (`/companies/<slug>/__data.json`) carries the site, social profiles and the
 * official Apply links of the company's jobs. Job texts are not kept: a link only
 * tells which board or careers section the company uses.
 */
import type { FreehireCompanyCard } from './freehireClient';

export const FREEHIRE_SITE = 'https://freehire.me';
export const PAGES_USER_AGENT = 'openqareer-directory/1.0 (+https://openqareer.com)';

export interface FreehirePageCard extends FreehireCompanyCard {
  readonly linkedin: string | null;
  /** Other public profiles by network: twitter, facebook, instagram, github… */
  readonly profiles: Readonly<Record<string, string>>;
}

const SITEMAP_SLUG = /<loc>https:\/\/freehire\.me\/companies\/([^<?#/]+)<\/loc>/g;

export function slugsOfSitemap(xml: string): readonly string[] {
  return [...xml.matchAll(SITEMAP_SLUG)].map((m) => m[1]!);
}

/** SvelteKit `devalue` flat array → plain value (index 0 is the root). */
export function hydrate(data: readonly unknown[]): unknown {
  const cache = new Map<number, unknown>();
  const at = (index: number): unknown => {
    if (typeof index !== 'number' || index < 0) return null;
    if (cache.has(index)) return cache.get(index);
    const raw = data[index];
    if (Array.isArray(raw)) {
      const list: unknown[] = [];
      cache.set(index, list);
      for (const item of raw) list.push(at(item as number));
      return list;
    }
    if (raw && typeof raw === 'object') {
      const object: Record<string, unknown> = {};
      cache.set(index, object);
      for (const [key, item] of Object.entries(raw)) object[key] = at(item as number);
      return object;
    }
    cache.set(index, raw);
    return raw;
  };
  return at(0);
}

const PROFILE_KEYS =
  /^(twitter|facebook|instagram|youtube|github|crunchbase|glassdoor|telegram|angellist|wellfound|tiktok)$/;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Freehire attribution is dropped from every kept link. */
export function withoutFreehireTracking(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()])
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}

/** Company card from one `__data.json`; null when the page has no company node. */
export function cardOfPageData(slug: string, body: unknown): FreehirePageCard | null {
  const nodes = (body as { nodes?: unknown[] } | null)?.nodes;
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    const data = (node as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) continue;
    const root = data[0] as Record<string, unknown> | undefined;
    if (!root || typeof root !== 'object' || !('company' in root)) continue;
    const page = hydrate(data) as {
      company?: Record<string, unknown> | null;
      initial?: { items?: unknown[] } | null;
    };
    const company = page.company;
    const name = str(company?.name);
    if (!company || !name) return null;
    const info = (company.company_info ?? {}) as Record<string, unknown>;
    const profiles: Record<string, string> = {};
    for (const [key, value] of Object.entries(info)) {
      const link = str(value);
      if (link && PROFILE_KEYS.test(key)) profiles[key] = link;
    }
    const jobs = (page.initial?.items ?? []).flatMap((item) => {
      const job = item as { source?: unknown; url?: unknown } | null;
      const url = str(job?.url);
      return url ? [{ source: str(job?.source) ?? '', url: withoutFreehireTracking(url) }] : [];
    });
    return {
      slug,
      name,
      website: str(info.website),
      linkedin: companyLinkedin(str(info.linkedin)),
      profiles,
      jobs,
    };
  }
  return null;
}

/** Only a company page: `linkedin.com/company/<slug>`, normalized. */
export function companyLinkedin(raw: string | null): string | null {
  const slug = raw ? /linkedin\.com\/company\/([^/?#\s]+)/i.exec(raw)?.[1] : undefined;
  return slug ? `https://www.linkedin.com/company/${decodeURIComponent(slug).toLowerCase()}` : null;
}
