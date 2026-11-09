/**
 * B627: maintenance step — the directory backlog through the discovery model (`discoveryModel.ts`:
 * Vertex under a $40 cap, then the free OpenRouter pool), then HTTP checks. Five model calls of ten
 * companies per tick, ten seconds apart, so the backlog clears in a night.
 * Rollback: OPENQAREER_SITE_DISCOVERY_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { AskModel, ModelReply } from './discoveryModel';
import {
  discoveryPrompt,
  parseModelAnswer,
  readPendingCompanies,
  verifyCompany,
  writeDiscovery,
  type PendingCompany,
} from './siteDiscovery';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const BATCH = 10;
const PARALLEL = 5;
const FIRST_RUN_MS = 7 * 60_000;
const BETWEEN_MS = 10_000;
const IDLE_MS = 60 * 60_000;
const FAILED_MS = 5 * 60_000;

export interface TickResult {
  readonly checked: number;
  readonly boards: number;
  readonly vertex: number;
  readonly openrouter: number;
}

async function runGroup(
  database: DatabaseSync,
  companies: readonly PendingCompany[],
  ask: AskModel,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<{ checked: number; boards: number; route: ModelReply['route'] }> {
  const reply = await ask(discoveryPrompt(companies));
  const answers = parseModelAnswer(reply.text);
  const day = now.toISOString().slice(0, 10);
  let boards = 0;
  for (const company of companies) {
    const found = await verifyCompany(company, answers.find((a) => a.key === company.companyKey), fetchImpl, day);
    if (found.board) boards += 1;
    writeDiscovery(database, found, now.toISOString());
  }
  return { checked: companies.length, boards, route: reply.route };
}

/** One tick: up to PARALLEL model calls of BATCH companies; checked = 0 means nothing pending. */
export async function runSiteDiscoveryTick(
  database: DatabaseSync,
  ask: AskModel,
  fetchImpl: typeof fetch,
  now: Date = new Date(),
): Promise<TickResult> {
  const companies = readPendingCompanies(database, BATCH * PARALLEL);
  if (companies.length === 0) return { checked: 0, boards: 0, vertex: 0, openrouter: 0 };
  const groups: (readonly PendingCompany[])[] = [];
  for (let i = 0; i < companies.length; i += BATCH) groups.push(companies.slice(i, i + BATCH));
  const settled = await Promise.allSettled(groups.map((g) => runGroup(database, g, ask, fetchImpl, now)));
  const done = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (done.length === 0 && failed) throw failed.reason;
  return {
    checked: done.reduce((sum, d) => sum + d.checked, 0),
    boards: done.reduce((sum, d) => sum + d.boards, 0),
    vertex: done.filter((d) => d.route === 'vertex').length,
    openrouter: done.filter((d) => d.route === 'openrouter').length,
  };
}

export function scheduleSiteDiscovery(database: DatabaseSync, log: Log, ask: AskModel | undefined): () => void {
  if (!ask) return () => {};
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const result = await runSiteDiscoveryTick(database, ask, fetch);
      if (result.checked > 0) log.info({ ...result }, 'site-discovery-tick');
      next(result.checked === 0 ? IDLE_MS : BETWEEN_MS);
    } catch (error: unknown) {
      log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'site-discovery-failed');
      next(FAILED_MS);
    }
  };
  next(FIRST_RUN_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
