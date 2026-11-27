/**
 * B627 / B643-9: maintenance step — the directory backlog through the
 * deterministic resolver (no model). CPO 11.11: every company without an ATS,
 * the 500/day cap is lifted; target ≥50k a day: 12 companies in parallel (24 pushed stalls to ×1.5),
 * ≤1 request a second per host, 5 s rest between batches of 200. The ordered queue (most pool
 * vacancies first) is read in pages once per QUEUE_TTL_MS.
 * Rollback: OPENQAREER_SITE_DISCOVERY_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import { resolveCompany } from './deterministicResolver';
import { politeFetch } from './hostLimiter';
import { publicApiCounter } from '../freehire/freehireRepoCheck';
import { DirectAtsDiscovery, DIRECT_ATS_FRESH_MS } from './directAtsDiscovery';
import {
  directoryWindowEnd,
  readPendingPage,
  writeDiscovery,
  type HostCheck,
  type PendingCompany,
} from './siteDiscovery';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const BATCH = 200;
/** Parallel companies; every host still gets ≤1 request a second (`politeFetch`). */
const WORKERS = 12;
const FIRST_RUN_MS = 7 * 60_000;
const BETWEEN_MS = 5_000;
/** Directory rows one read looks at; a page of matches walked the whole directory at once (B761). */
const WINDOW = 500;
const QUEUE_TTL_MS = 6 * 60 * 60_000;
const IDLE_MS = 10 * 60_000;
const MAX_QUEUE_BUFFER = 500;
const DEMAND_PREFETCH_LIMIT = 100;

export interface TickResult {
  readonly checked: number;
  readonly boards: number;
  readonly ambiguous: number;
  readonly directChecks: number;
  readonly liveDirectBoards: number;
}

function loadDemandPriorityRows(database: DatabaseSync): PendingCompany[] {
  const hasVc = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vacancy_company'")
    .get();
  if (!hasVc) return [];
  const rows = database
    .prepare(
      `SELECT d.company_key AS companyKey, d.company_name AS companyName,
              d.website_url AS websiteUrl, d.linkedin_url AS linkedinUrl,
              json_extract(d.evidence, '$.careersUrlDropped.value') AS droppedCareersUrl,
              CASE WHEN d.evidence IS NOT NULL AND instr(d.evidence, 'B643-9') > 0 THEN 1 ELSE 0 END AS siteSearched
         FROM (SELECT company_key, count(*) AS cnt FROM vacancy_company GROUP BY company_key ORDER BY cnt DESC LIMIT ?) v
         JOIN company_directory d ON d.company_key = v.company_key
        WHERE d.status = 'active' AND d.ats_provider IS NULL
          AND NOT EXISTS (SELECT 1 FROM company_placement p WHERE p.company_key = d.company_key AND p.type = 'ats')
        ORDER BY v.cnt DESC`,
    )
    .all(DEMAND_PREFETCH_LIMIT) as unknown as Array<
    Omit<PendingCompany, 'siteSearched'> & { siteSearched: number }
  >;
  return rows.map(({ siteSearched, ...rest }) => ({
    ...rest,
    ...(siteSearched ? { siteSearched: true } : {}),
  }));
}

/**
 * Pending companies bounded in memory (`MAX_QUEUE_BUFFER`), scanning primary-key windows (`B761`).
 * Once a full pass finishes, re-reading rests for `QUEUE_TTL_MS` (6 h).
 */
export class PendingQueue {
  private items: PendingCompany[] = [];
  private cursor = '';
  private exhaustedAt = -Infinity;

  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
    private readonly direct?: Pick<DirectAtsDiscovery, 'prioritized'>,
  ) {}

  async next(count: number): Promise<readonly PendingCompany[]> {
    if (
      this.items.length === 0 &&
      (this.cursor !== '' || this.now() - this.exhaustedAt > QUEUE_TTL_MS)
    ) {
      await this.refresh(count);
    }
    return this.items.splice(0, count);
  }

  private async refresh(requestedCount: number): Promise<void> {
    const directSince = this.direct ? this.now() - DIRECT_ATS_FRESH_MS : undefined;
    const buffered: PendingCompany[] =
      this.cursor === '' ? loadDemandPriorityRows(this.database) : [];
    const seen = new Set(buffered.map((c) => c.companyKey));
    const cap = Math.max(requestedCount, MAX_QUEUE_BUFFER);

    while (buffered.length < cap) {
      const until = directoryWindowEnd(this.database, this.cursor, WINDOW);
      if (until === undefined) {
        this.cursor = '';
        this.exhaustedAt = this.now();
        break;
      }
      for (const c of readPendingPage(this.database, this.cursor, WINDOW, directSince, until)) {
        if (!seen.has(c.companyKey)) {
          seen.add(c.companyKey);
          buffered.push(c);
        }
      }
      this.cursor = until;
      await new Promise((resolve) => setImmediate(resolve));
    }

    if (this.direct) {
      const priority: PendingCompany[] = [];
      const fallback: PendingCompany[] = [];
      for (const company of buffered) {
        if (this.direct.prioritized(company)) priority.push(company);
        else if (!company.siteSearched) fallback.push(company);
      }
      this.items = [...priority, ...fallback];
    } else {
      this.items = buffered;
    }
  }
}

/** One tick: BATCH companies through WORKERS parallel workers; checked = 0 means nothing pending. */
export async function runSiteDiscoveryTick(
  database: DatabaseSync,
  fetchImpl: typeof fetch,
  now: Date = new Date(),
  queue: Pick<PendingQueue, 'next'> = new PendingQueue(database),
  hostIsPublic?: HostCheck,
  direct?: Pick<DirectAtsDiscovery, 'probe'>,
): Promise<TickResult> {
  const companies = await queue.next(BATCH);
  const day = now.toISOString().slice(0, 10);
  let boards = 0;
  let ambiguous = 0;
  let directChecks = 0;
  let liveDirectBoards = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < companies.length) {
      const company = companies[cursor++]!;
      const result = await direct?.probe(company, now);
      if (result) {
        directChecks += result.checked;
        liveDirectBoards += result.live;
        if (result.live > 0) continue;
      }
      if (company.siteSearched) continue;
      const found = await resolveCompany(company, fetchImpl, day, hostIsPublic);
      if (found.board) boards += 1;
      if (found.evidence.atsAmbiguous) ambiguous += 1;
      // A guessed board or careers URL can activate an incomplete profile.
      // Keep the observation in evidence until the company is reviewed,
      // while verified site pages and hh employer IDs go to placements.
      writeDiscovery(
        database,
        {
          companyKey: found.companyKey,
          evidence: found.evidence,
          ...(found.websiteUrl ? { websiteUrl: found.websiteUrl } : {}),
          ...(found.evidence.careersUrl ? { careersUrl: found.careersUrl } : {}),
          ...(found.hhEmployerIds && found.hhEmployerIds.length > 0 ? { hhEmployerIds: found.hhEmployerIds } : {}),
        },
        now.toISOString(),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, companies.length) }, worker));
  return { checked: companies.length, boards, ambiguous, directChecks, liveDirectBoards };
}

export function scheduleSiteDiscovery(database: DatabaseSync, log: Log): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const polite = politeFetch(fetch);
  const directFetch: typeof fetch = (input, init) => polite(input, { ...init, redirect: 'error' });
  const direct = new DirectAtsDiscovery(database, publicApiCounter(directFetch));
  const queue = new PendingQueue(database, Date.now, direct);
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const result = await runSiteDiscoveryTick(database, polite, new Date(), queue, undefined, direct);
      if (result.checked > 0) log.info({ ...result }, 'site-discovery-tick');
      next(result.checked === 0 ? IDLE_MS : BETWEEN_MS);
    } catch (error: unknown) {
      log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'site-discovery-failed');
      next(BETWEEN_MS);
    }
  };
  next(FIRST_RUN_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
