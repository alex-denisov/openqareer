/**
 * B641: polite client for the open freehire.me API (MIT, github.com/strelov1/freehire).
 * One request at a time, at most ~2 per second; 429 and 5xx wait and retry, and every
 * 429 widens the gap between requests until answers come back clean.
 */
export const FREEHIRE_BASE = 'https://freehire.me/api/v1';
export const FREEHIRE_USER_AGENT = 'openqareer-company-directory/1.0 (+https://openqareer.com)';

const MIN_GAP_MS = 500;
const MAX_GAP_MS = 10_000;
const MAX_ATTEMPTS = 5;
/** A Retry-After longer than this is the daily quota (2000 per IP), not a burst. */
const LONG_PAUSE_S = 600;

/** freehire.me quota is spent; untilMs is when it resets. */
export class FreehireQuotaError extends Error {
  constructor(readonly untilMs: number) {
    super('freehire daily quota reached');
    this.name = 'FreehireQuotaError';
  }
}

export interface FreehireCompanyListItem {
  readonly slug: string;
  readonly name: string;
  readonly jobCount: number;
}

export interface FreehireJobLink {
  readonly source: string;
  readonly url: string;
}

export interface FreehireCompanyCard {
  readonly slug: string;
  readonly name: string;
  readonly website: string | null;
  readonly jobs: readonly FreehireJobLink[];
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class FreehireClient {
  private gapMs = MIN_GAP_MS;
  private lastAt = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: Sleep = realSleep,
    private readonly now: () => number = Date.now,
  ) {}

  get currentGapMs(): number {
    return this.gapMs;
  }

  private async getJson(path: string): Promise<unknown> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const wait = this.lastAt + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastAt = this.now();
      let status = 0;
      let retryAfter = 0;
      try {
        const response = await this.fetchImpl(`${FREEHIRE_BASE}${path}`, {
          headers: { accept: 'application/json', 'user-agent': FREEHIRE_USER_AGENT },
          signal: AbortSignal.timeout(20_000),
        });
        status = response.status;
        if (status === 200) {
          this.gapMs = Math.max(MIN_GAP_MS, Math.round(this.gapMs * 0.95));
          return await response.json();
        }
        if (status === 404) return null;
        retryAfter = Number(response.headers?.get('retry-after')) || 0;
      } catch {
        status = 0;
      }
      if (status !== 0 && status !== 429 && status < 500) throw new Error(`freehire HTTP ${status}`);
      if (status === 429 && retryAfter > LONG_PAUSE_S) throw new FreehireQuotaError(this.now() + retryAfter * 1000);
      if (status === 429) this.gapMs = Math.min(MAX_GAP_MS, this.gapMs * 2);
      await this.sleep(Math.max(retryAfter * 1000, 2 ** attempt * 1000));
    }
    throw new Error(`freehire ${path} failed after ${MAX_ATTEMPTS} attempts`);
  }

  /** Companies by job_count, largest first (the API's own order). */
  async listCompanies(offset: number, limit: number): Promise<{ items: FreehireCompanyListItem[]; total: number }> {
    const body = (await this.getJson(`/companies?limit=${limit}&offset=${offset}`)) as {
      data?: { slug?: unknown; name?: unknown; job_count?: unknown }[];
      meta?: { total?: unknown };
    } | null;
    const items = (body?.data ?? []).flatMap((row) =>
      typeof row.slug === 'string' && typeof row.name === 'string'
        ? [{ slug: row.slug, name: row.name, jobCount: typeof row.job_count === 'number' ? row.job_count : 0 }]
        : [],
    );
    return { items, total: typeof body?.meta?.total === 'number' ? body.meta.total : 0 };
  }

  async companyCard(slug: string): Promise<FreehireCompanyCard | null> {
    const body = (await this.getJson(`/companies/${encodeURIComponent(slug)}`)) as {
      data?: {
        company?: { slug?: unknown; name?: unknown; company_info?: { website?: unknown } | null };
        jobs?: { source?: unknown; url?: unknown }[];
      };
    } | null;
    const company = body?.data?.company;
    if (!company || typeof company.name !== 'string') return null;
    const website = company.company_info?.website;
    return {
      slug,
      name: company.name,
      website: typeof website === 'string' && website.trim() ? website.trim() : null,
      jobs: (body?.data?.jobs ?? []).flatMap((job) =>
        typeof job.source === 'string' && typeof job.url === 'string' ? [{ source: job.source, url: job.url }] : [],
      ),
    };
  }
}
