/**
 * B645: stage source links from company pages, following the FreeHire sitemap.
 * The shard cursor and totals in `freehire_pages_state` survive process restarts.
 * Rollback: OPENQAREER_FREEHIRE_PAGES_OFF=1.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { runSqliteTransaction } from '../../data/sqliteTransaction';
import { boardFromJobUrl, boardsOfCard, cleanWebsite, isAggregator, nameKey } from './freehireImport';
import { FreehirePagesClient, FreehirePagesLimitError } from './freehirePagesClient';
import type { FreehirePageCard } from './freehirePages';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export const SHARD = 10_000;
const BATCH = 30;
const IN_FLIGHT = 4;
const FIRST_RUN_MS = 8 * 60_000;
const BETWEEN_MS = 200;
const DONE_MS = 7 * 24 * 60 * 60_000;
const FAILED_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;

export interface PagesState {
  shard: number;
  index: number;
  done?: string;
  candidatePass?: true;
  pausedUntil?: string;
  read: number;
  failed: number;
  skipped: number;
  websites: number;
  linkedin: number;
  careers: number;
  boards: Record<string, number>;
}

const STATE_SQL = `CREATE TABLE IF NOT EXISTS freehire_pages_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, updated_at TEXT NOT NULL)`;
const EMPTY: PagesState = {
  shard: 0,
  index: 0,
  read: 0,
  failed: 0,
  skipped: 0,
  websites: 0,
  linkedin: 0,
  careers: 0,
  boards: {},
};

export function readPagesState(database: DatabaseSync): PagesState {
  database.exec(STATE_SQL);
  const row = database.prepare('SELECT state FROM freehire_pages_state WHERE id = 1').get() as
    { state: string } | undefined;
  if (!row) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(row.state) as Partial<PagesState>) };
  } catch {
    return EMPTY;
  }
}

function savePagesState(database: DatabaseSync, state: PagesState, now: Date): void {
  database
    .prepare(
      `INSERT INTO freehire_pages_state (id, state, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(state), now.toISOString());
}

const NOT_A_NAME_LABEL =
  /^(www|jobs?|careers?|apply|join|work|talent|recruiting|hr|en|us|uk|global|com|net|org|co|io)$/;
const compact = (value: string): string => nameKey(value).replace(/-/g, '');

/** A host label that is the company's own name: amazon.jobs, careers.acme.com. */
function hostIsCompany(hostname: string, card: FreehirePageCard): boolean {
  const names = [compact(card.name), compact(card.slug)].filter((n) => n.length >= 4);
  const labels = hostname
    .toLowerCase()
    .split('.')
    .slice(0, -1)
    .map((l) => l.replace(/[^a-z0-9]/g, ''));
  return labels.some(
    (label) =>
      label.length >= 4 &&
      !NOT_A_NAME_LABEL.test(label) &&
      names.some((name) => name.startsWith(label) || label.startsWith(name)),
  );
}

export interface EmployerJobSite {
  /** Origin of the employer's own jobs domain. */
  readonly origin: string;
  /** Careers section: the jobs host, or `/<first path segment>` on the main site. */
  readonly careers: string;
}

/**
 * B645: an Apply link that is neither an ATS board nor an aggregator but the
 * employer's own domain (amazon.jobs, careers.acme.com, acme.com/careers/12).
 */
export function employerJobSite(card: FreehirePageCard): EmployerJobSite | null {
  for (const job of card.jobs) {
    if (boardFromJobUrl(job.url) || isAggregator(job.url)) continue;
    try {
      const url = new URL(job.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      if (!cleanWebsite(url.origin) || !hostIsCompany(url.hostname, card)) continue;
      const first = url.pathname.split('/').filter(Boolean)[0];
      const onMainSite =
        /^(www\.)?[^.]+\.[^.]+$/.test(url.hostname) &&
        first &&
        /job|career|vacanc|karriere|stellen|empleo|emploi/i.test(first);
      return {
        origin: `${url.origin}/`,
        careers: onMainSite ? `${url.origin}/${first}` : `${url.origin}/`,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchCards(
  client: FreehirePagesClient,
  slugs: readonly string[],
): Promise<(FreehirePageCard | null | undefined)[]> {
  const out: (FreehirePageCard | null | undefined)[] = new Array(slugs.length);
  let next = 0;
  const worker = async () => {
    while (next < slugs.length) {
      const at = next++;
      out[at] = await client.card(slugs[at]!);
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  return out;
}

export interface PagesPass {
  slugs?: readonly string[];
}

/** One batch; returns read = 0 when the pass is done or paused. */
export async function runPagesTick(
  database: DatabaseSync,
  client: FreehirePagesClient,
  pass: PagesPass,
  now: () => Date = () => new Date(),
): Promise<{ read: number; state: PagesState }> {
  let state = readPagesState(database);
  if (state.done) {
    // The completed legacy pass retained only selected placements. Collect its
    // first evidence snapshot immediately, then observe the weekly cadence.
    if (state.candidatePass && now().getTime() < Date.parse(state.done) + DONE_MS)
      return { read: 0, state };
    state = { ...EMPTY, candidatePass: true };
    savePagesState(database, state, now());
    pass.slugs = undefined;
  }
  if (state.pausedUntil && now() < new Date(state.pausedUntil)) return { read: 0, state };
  pass.slugs ??= await client.sitemapSlugs(state.shard);
  if (pass.slugs.length === 0) {
    state = { ...state, done: now().toISOString(), candidatePass: true };
    savePagesState(database, state, now());
    return { read: 0, state };
  }
  if (state.index >= pass.slugs.length) {
    state = { ...state, shard: state.shard + SHARD, index: 0 };
    savePagesState(database, state, now());
    pass.slugs = undefined;
    return { read: 1, state };
  }
  const slugs = pass.slugs.slice(state.index, state.index + BATCH);
  let cards: (FreehirePageCard | null | undefined)[];
  try {
    cards = await fetchCards(client, slugs);
  } catch (error: unknown) {
    if (!(error instanceof FreehirePagesLimitError)) throw error;
    state = { ...state, pausedUntil: new Date(error.untilMs).toISOString() };
    savePagesState(database, state, now());
    return { read: 0, state };
  }
  state = runSqliteTransaction(database, () => {
    const observedAt = now();
    const next = writeCandidates(database, cards, state, observedAt);
    next.index += slugs.length;
    next.pausedUntil = undefined;
    savePagesState(database, next, observedAt);
    return next;
  });
  return { read: slugs.length, state };
}

/**
 * Discovery is evidence only. Neither these cards nor their links enter the
 * vacancy polling registry until company identity and source eligibility are verified.
 */
function writeCandidates(
  database: DatabaseSync,
  cards: readonly (FreehirePageCard | null | undefined)[],
  start: PagesState,
  now: Date,
): PagesState {
  database.exec(`CREATE TABLE IF NOT EXISTS freehire_company_source_candidates (
    slug TEXT PRIMARY KEY, evidence TEXT NOT NULL, fetched_at TEXT NOT NULL
  ) STRICT`);
  const save = database.prepare(`INSERT INTO freehire_company_source_candidates (slug, evidence, fetched_at)
    VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET
      evidence = excluded.evidence, fetched_at = excluded.fetched_at`);
  const state: PagesState = { ...start, boards: { ...start.boards } };
  const stamp = now.toISOString();
  for (const card of cards) {
    state.read++;
    if (card === undefined) {
      state.failed++;
      continue;
    }
    if (card === null) {
      state.skipped++;
      continue;
    }
    const employerSite = employerJobSite(card);
    const careers = employerSite?.careers ?? null;
    // These parser-derived IDs are hints. Raw job URLs preserve case and region.
    const boards = boardsOfCard(card);
    save.run(card.slug, JSON.stringify({ ...card, employerSite, careers, boards }), stamp);
    if (card.website) state.websites++;
    if (card.linkedin) state.linkedin++;
    if (careers) state.careers++;
    for (const { provider } of boards) state.boards[provider] = (state.boards[provider] ?? 0) + 1;
  }
  return state;
}

function logTick(
  log: Log,
  read: number,
  state: PagesState,
  client: FreehirePagesClient,
  ms: number,
  hourly: boolean,
): void {
  const boards = JSON.stringify(state.boards);
  if (hourly)
    log.info(
      { ...state, boards, gapMs: client.currentGapMs, throttled: client.throttled, ms },
      'freehire-pages-hourly',
    );
  if (read === 0 && state.pausedUntil)
    log.error({ pausedUntil: state.pausedUntil, read: state.read }, 'freehire-pages-limited');
  if (read === 0 && state.done) log.info({ ...state, boards }, 'freehire-pages-done');
}

/** The pass loop itself; runs in the worker thread on prod, in-process elsewhere. */
export function runFreehirePagesLoop(
  database: DatabaseSync,
  log: Log,
  firstRunMs = FIRST_RUN_MS,
): () => void {
  const client = new FreehirePagesClient();
  const pass: PagesPass = {};
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  // One summary line an hour (and the first tick) for the CPO to read from the journal.
  let loggedAt = 0;
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const started = Date.now();
      const { read, state } = await runPagesTick(database, client, pass);
      if (read > 0 && Date.now() - loggedAt >= HOUR_MS) loggedAt = Date.now();
      logTick(log, read, state, client, Date.now() - started, read > 0 && loggedAt >= started);
      const refreshAt = state.done ? Date.parse(state.done) + DONE_MS : Date.now() + DONE_MS;
      next(
        read > 0
          ? BETWEEN_MS
          : state.pausedUntil
            ? Math.max(60_000, Date.parse(state.pausedUntil) - Date.now())
            : Math.max(BETWEEN_MS, refreshAt - Date.now()),
      );
    } catch (error: unknown) {
      pass.slugs = undefined;
      log.error(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : '',
        },
        'freehire-pages-failed',
      );
      next(FAILED_MS);
    }
  };
  next(firstRunMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

const WORKER_FILE = 'freehire-pages-worker.mjs';

/**
 * B645: the maintenance loop stalls for seconds (225 event-loop stalls in 30 min on
 * 11.11), which held a 30-page batch for 91 s. On prod the pass runs in its own
 * thread with its own connection; without the built worker file (tests, dev) in-process.
 */
export function scheduleFreehirePages(
  database: DatabaseSync,
  log: Log,
  env: NodeJS.ProcessEnv,
): () => void {
  if (env.OPENQAREER_FREEHIRE_PAGES_OFF === '1') return () => {};
  const workerFile = join(dirname(process.argv[1] ?? ''), WORKER_FILE);
  const path = database.location();
  if (!path || !existsSync(workerFile)) return runFreehirePagesLoop(database, log);
  const worker = new Worker(workerFile, { workerData: { path } });
  worker.on(
    'message',
    (m: { level: 'info' | 'error'; details: Record<string, unknown>; message: string }) =>
      log[m.level]({ ...m.details, thread: 'freehire-pages' }, m.message),
  );
  worker.on('error', (error: Error) =>
    log.error({ errorName: error.name, message: error.message }, 'freehire-pages-failed'),
  );
  worker.unref();
  return () => void worker.terminate();
}
