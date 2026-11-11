/**
 * B627 / B643-9: maintenance step — the directory backlog through the
 * deterministic resolver (no model), ten companies every 30 minutes, so at
 * most 480 companies a day (CPO cap 500). Rollback: OPENQAREER_SITE_DISCOVERY_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import { resolveCompany } from './deterministicResolver';
import { readPendingCompanies, writeDiscovery } from './siteDiscovery';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const BATCH = 10;
const FIRST_RUN_MS = 7 * 60_000;
const BETWEEN_MS = 30 * 60_000;
const IDLE_MS = 6 * 60 * 60_000;

export interface TickResult {
  readonly checked: number;
  readonly boards: number;
}

/** One tick: BATCH companies one after another; checked = 0 means nothing pending. */
export async function runSiteDiscoveryTick(
  database: DatabaseSync,
  fetchImpl: typeof fetch,
  now: Date = new Date(),
): Promise<TickResult> {
  const companies = readPendingCompanies(database, BATCH);
  const day = now.toISOString().slice(0, 10);
  let boards = 0;
  for (const company of companies) {
    const found = await resolveCompany(company, fetchImpl, day);
    if (found.board) boards += 1;
    writeDiscovery(database, found, now.toISOString());
  }
  return { checked: companies.length, boards };
}

export function scheduleSiteDiscovery(database: DatabaseSync, log: Log): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const result = await runSiteDiscoveryTick(database, fetch);
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
