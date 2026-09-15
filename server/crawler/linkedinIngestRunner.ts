import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { SourceReading } from '../vacancies/multiSourceVacancyEngine';
import { LinkedinAccountPool } from './linkedinAccountPool';
import { LinkedinScraper, resolveLinkedinProxyUrl } from './linkedinScraper';

export const LINKEDIN_CRAWLER_SOURCE_ID = 'src-linkedin-crawler';
export const DEFAULT_LINKEDIN_KEYWORDS = ['Software Engineer'] as const;
export const DEFAULT_LINKEDIN_POST_KEYWORDS = ['#hiring'] as const;

export interface LinkedinCrawlerDeps {
  readonly scraper?: LinkedinScraper;
  readonly pool?: LinkedinAccountPool;
  readonly keywords?: readonly string[];
  readonly postKeywords?: readonly string[];
  readonly query?: string;
}

function createDefaultAccountPool(): LinkedinAccountPool {
  const envIds = process.env.LINKEDIN_ACCOUNT_IDS;
  const accountIds = envIds
    ? envIds.split(',').map((id) => id.trim()).filter(Boolean)
    : [];
  const storageRoot =
    process.env.LINKEDIN_STORAGE_ROOT || '/tmp/openqareer-linkedin-pool';
  return new LinkedinAccountPool({
    accountIds,
    storageRoot,
  });
}

function resolveScraperAndPool(deps?: LinkedinCrawlerDeps): {
  scraper: LinkedinScraper;
  pool: LinkedinAccountPool;
} {
  const pool = deps?.pool ?? deps?.scraper?.pool ?? createDefaultAccountPool();
  const scraper =
    deps?.scraper ??
    new LinkedinScraper({
      pool,
      proxyUrl: resolveLinkedinProxyUrl(),
    });
  return { scraper, pool };
}

function isPoolAvailable(pool: LinkedinAccountPool): boolean {
  const summary = pool.getPoolSummary();
  return summary.total > 0 && summary.active > 0;
}

async function crawlJobs(
  scraper: LinkedinScraper,
  pool: LinkedinAccountPool,
  keywords: readonly string[],
): Promise<UnifiedVacancy[]> {
  const collected: UnifiedVacancy[] = [];
  for (const kw of keywords) {
    if (!isPoolAvailable(pool)) break;
    const result = await scraper.scrapeJobs({ keywords: kw, location: 'Remote' });
    if (result.status === 'success' && result.vacancies.length > 0) {
      collected.push(...result.vacancies);
    }
  }
  return collected;
}

async function crawlPosts(
  scraper: LinkedinScraper,
  pool: LinkedinAccountPool,
  postKeywords: readonly string[],
): Promise<UnifiedVacancy[]> {
  const collected: UnifiedVacancy[] = [];
  for (const pkw of postKeywords) {
    if (!isPoolAvailable(pool)) break;
    const result = await scraper.scrapePosts({ keywords: pkw });
    if (result.status === 'success' && result.vacancies.length > 0) {
      collected.push(...result.vacancies);
    }
  }
  return collected;
}

export function formatCrawlerVacancy(
  vacancy: UnifiedVacancy,
  sourceId = LINKEDIN_CRAWLER_SOURCE_ID,
): UnifiedVacancy {
  return {
    ...vacancy,
    provenance: {
      ...vacancy.provenance,
      sourceId,
      sourceType: 'linkedin_crawler',
      sourceName: vacancy.provenance?.sourceName ?? 'LinkedIn (Obscura Crawler)',
    },
  };
}

export async function fetchLinkedinCrawler(
  deps?: LinkedinCrawlerDeps,
): Promise<SourceReading> {
  const { scraper, pool } = resolveScraperAndPool(deps);

  if (!isPoolAvailable(pool)) {
    return { vacancies: [], partial: true };
  }

  const keywords =
    deps?.keywords ??
    (deps?.query ? [deps.query] : DEFAULT_LINKEDIN_KEYWORDS);
  const postKeywords = deps?.postKeywords ?? DEFAULT_LINKEDIN_POST_KEYWORDS;

  const jobVacancies = await crawlJobs(scraper, pool, keywords);
  const postVacancies = await crawlPosts(scraper, pool, postKeywords);

  const seen = new Map<string, UnifiedVacancy>();
  for (const v of [...jobVacancies, ...postVacancies]) {
    if (!seen.has(v.id)) {
      seen.set(v.id, formatCrawlerVacancy(v));
    }
  }

  return {
    vacancies: Array.from(seen.values()),
    partial: true,
  };
}
