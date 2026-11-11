/**
 * B627 / B643-9: maintenance step — the directory backlog through the
 * deterministic resolver (no model). CPO 11.11: every company without an ATS,
 * the 500/day cap is lifted; pace is set by load: ten companies one after
 * another, then a minute of rest (≈14k a day). The ordered queue (most pool
 * vacancies first) is read in pages once per QUEUE_TTL_MS.
 * Rollback: OPENQAREER_SITE_DISCOVERY_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import { resolveCompany } from './deterministicResolver';
import { orderByVacancies, readPendingPage, vacancyCounts, writeDiscovery, type PendingCompany } from './siteDiscovery';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const BATCH = 10;
const FIRST_RUN_MS = 7 * 60_000;
const BETWEEN_MS = 60_000;
const PAGE = 2_000;
const QUEUE_TTL_MS = 6 * 60 * 60_000;
const IDLE_MS = 6 * 60 * 60_000;

export interface TickResult {
  readonly checked: number;
  readonly boards: number;
  readonly ambiguous: number;
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
  ) {}

  async next(count: number): Promise<readonly PendingCompany[]> {
    if (this.items.length === 0 || this.now() - this.readAt > QUEUE_TTL_MS) await this.refresh();
    return this.items.splice(0, count);
  }

  private async refresh(): Promise<void> {
    const all: PendingCompany[] = [];
    let after = '';
    for (;;) {
      const page = readPendingPage(this.database, after, PAGE);
      all.push(...page);
      if (page.length < PAGE) break;
      after = page.at(-1)!.companyKey;
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.items = orderByVacancies(all, vacancyCounts(this.database));
    this.readAt = this.now();
  }
}

/** One tick: BATCH companies one after another; checked = 0 means nothing pending. */
export async function runSiteDiscoveryTick(
  database: DatabaseSync,
  fetchImpl: typeof fetch,
  now: Date = new Date(),
  queue: Pick<PendingQueue, 'next'> = new PendingQueue(database),
): Promise<TickResult> {
  const companies = await queue.next(BATCH);
  const day = now.toISOString().slice(0, 10);
  let boards = 0;
  let ambiguous = 0;
  for (const company of companies) {
    const found = await resolveCompany(company, fetchImpl, day);
    if (found.board) boards += 1;
    if (found.evidence.atsAmbiguous) ambiguous += 1;
    writeDiscovery(database, found, now.toISOString());
  }
  return { checked: companies.length, boards, ambiguous };
}

export function scheduleSiteDiscovery(database: DatabaseSync, log: Log): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const queue = new PendingQueue(database);
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const result = await runSiteDiscoveryTick(database, fetch, new Date(), queue);
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
