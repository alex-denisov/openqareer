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
import { orderByVacancies, readPendingPage, vacancyCounts, writeDiscovery, type HostCheck, type PendingCompany } from './siteDiscovery';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const BATCH = 200;
/** Parallel companies; every host still gets ≤1 request a second (`politeFetch`). */
const WORKERS = 12;
const FIRST_RUN_MS = 7 * 60_000;
const BETWEEN_MS = 5_000;
const PAGE = 2_000;
const QUEUE_TTL_MS = 6 * 60 * 60_000;
const IDLE_MS = 6 * 60 * 60_000;

export interface TickResult {
  readonly checked: number;
  readonly boards: number;
  readonly ambiguous: number;
  readonly directChecks: number;
  readonly liveDirectBoards: number;
}

/**
 * Pending companies, most pool vacancies first. The directory is read in pages
 * of PAGE rows with the event loop free between pages; the list is reread when
 * empty or older than QUEUE_TTL_MS.
 */
export class PendingQueue {
  private items: PendingCompany[] = [];
  private readAt = -Infinity;

  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
    private readonly direct?: Pick<DirectAtsDiscovery, 'prioritized'>,
  ) {}

  async next(count: number): Promise<readonly PendingCompany[]> {
    if (this.items.length === 0 || this.now() - this.readAt > QUEUE_TTL_MS) await this.refresh();
    return this.items.splice(0, count);
  }

  private async refresh(): Promise<void> {
    const all: PendingCompany[] = [];
    let after = '';
    for (;;) {
      const page = readPendingPage(this.database, after, PAGE, this.direct ? this.now() - DIRECT_ATS_FRESH_MS : undefined);
      all.push(...page);
      if (page.length < PAGE) break;
      after = page.at(-1)!.companyKey;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const ordered = orderByVacancies(all, vacancyCounts(this.database));
    if (this.direct) {
      const priority: PendingCompany[] = [];
      const fallback: PendingCompany[] = [];
      for (const company of ordered) {
        if (this.direct.prioritized(company)) priority.push(company);
        else if (!company.siteSearched) fallback.push(company);
      }
      this.items = [...priority, ...fallback];
    } else {
      this.items = ordered;
    }
    this.readAt = this.now();
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
      // Keep the observation in evidence until the company is reviewed.
      writeDiscovery(database, { companyKey: found.companyKey, evidence: found.evidence }, now.toISOString());
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
