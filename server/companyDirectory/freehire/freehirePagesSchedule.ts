/**
 * B645: maintenance step — every freehire.me company page, shard by shard of the
 * sitemap, ~3 pages a second. Position (shard offset + index in it) and totals live
 * in `freehire_pages_state`, so a restart continues where it stopped. No model calls.
 * Rollback: OPENQAREER_FREEHIRE_PAGES_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  boardCheck,
  boardFromJobUrl,
  cleanWebsite,
  hostRoot,
  importCompany,
  loadDirectoryIndex,
  type BoardCheck,
  type DirectoryIndex,
} from './freehireImport';
import { FreehirePagesClient, FreehirePagesLimitError } from './freehirePagesClient';
import type { FreehirePageCard } from './freehirePages';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export const SHARD = 10_000;
const BATCH = 30;
const IN_FLIGHT = 3;
const FIRST_RUN_MS = 8 * 60_000;
const BETWEEN_MS = 200;
const DONE_MS = 7 * 24 * 60 * 60_000;
const FAILED_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;

export interface PagesState {
  shard: number;
  index: number;
  done?: string;
  pausedUntil?: string;
  read: number;
  failed: number;
  skipped: number;
  added: number;
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
  added: 0,
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

/**
 * Careers section on the company's own domain from a job link that is not an ATS
 * board: `careers.acme.com/...` → its origin, `acme.com/careers/123` → `/careers`.
 */
export function careersOnCompanySite(
  card: FreehirePageCard,
  website: string | null,
): string | null {
  const root = hostRoot(website);
  if (!root) return null;
  for (const job of card.jobs) {
    if (boardFromJobUrl(job.url)) continue;
    try {
      const url = new URL(job.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      if (hostRoot(url.origin) !== root) continue;
      const first = url.pathname.split('/').filter(Boolean)[0];
      const siteHost = new URL(website!).hostname.replace(/^www\./, '');
      if (url.hostname.replace(/^www\./, '') !== siteHost || !first) return `${url.origin}/`;
      return `${url.origin}/${first}`;
    } catch {
      continue;
    }
  }
  return null;
}

/** LinkedIn page, careers section and other profiles; only empty fields are filled. */
export function writePageExtras(
  database: DatabaseSync,
  companyKey: string,
  card: FreehirePageCard,
  careersUrl: string | null,
  stamp: string,
): { linkedinAdded: boolean; careersAdded: boolean } {
  const before = database
    .prepare('SELECT linkedin_url, careers_url FROM company_directory WHERE company_key = ?')
    .get(companyKey) as { linkedin_url: string | null; careers_url: string | null } | undefined;
  if (!before) return { linkedinAdded: false, careersAdded: false };
  const linkedinAdded = Boolean(card.linkedin && !before.linkedin_url);
  const careersAdded = Boolean(careersUrl && !before.careers_url);
  const evidence: Record<string, unknown> = {};
  if (Object.keys(card.profiles).length > 0)
    evidence.profiles = { value: card.profiles, how: 'freehire.me company page' };
  if (linkedinAdded)
    evidence.linkedinUrl = { value: card.linkedin, how: 'freehire.me company page' };
  if (careersAdded)
    evidence.careersUrl = {
      value: careersUrl,
      how: 'freehire.me job Apply link on the company domain',
    };
  if (!linkedinAdded && !careersAdded && Object.keys(evidence).length === 0)
    return { linkedinAdded, careersAdded };
  database
    .prepare(
      `UPDATE company_directory SET
         linkedin_url = COALESCE(linkedin_url, ?),
         careers_url = COALESCE(careers_url, ?),
         source_type = CASE WHEN ? IS NOT NULL AND source_type = 'linkedin_guest' THEN 'corporate_portal' ELSE source_type END,
         evidence = json_patch(COALESCE(evidence, '{}'), ?),
         updated_at = ?
       WHERE company_key = ?`,
    )
    .run(
      linkedinAdded ? card.linkedin : null,
      careersAdded ? careersUrl : null,
      careersAdded ? careersUrl : null,
      JSON.stringify(evidence),
      stamp,
      companyKey,
    );
  return { linkedinAdded, careersAdded };
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
  index?: DirectoryIndex;
}

/** One batch; returns read = 0 when the pass is done or paused. */
export async function runPagesTick(
  database: DatabaseSync,
  client: FreehirePagesClient,
  check: BoardCheck,
  pass: PagesPass,
  now: () => Date = () => new Date(),
): Promise<{ read: number; state: PagesState }> {
  let state = readPagesState(database);
  if (state.done) return { read: 0, state };
  if (state.pausedUntil && now() < new Date(state.pausedUntil)) return { read: 0, state };
  pass.slugs ??= await client.sitemapSlugs(state.shard);
  if (pass.slugs.length === 0) {
    state = { ...state, done: now().toISOString() };
    savePagesState(database, state, now());
    return { read: 0, state };
  }
  if (state.index >= pass.slugs.length) {
    state = { ...state, shard: state.shard + SHARD, index: 0 };
    savePagesState(database, state, now());
    pass.slugs = undefined;
    pass.index = undefined;
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
  pass.index ??= loadDirectoryIndex(database);
  state = await writeCards(database, pass.index, cards, check, state, now());
  state = { ...state, index: state.index + slugs.length, pausedUntil: undefined };
  savePagesState(database, state, now());
  return { read: slugs.length, state };
}

async function writeCards(
  database: DatabaseSync,
  index: DirectoryIndex,
  cards: readonly (FreehirePageCard | null | undefined)[],
  check: BoardCheck,
  start: PagesState,
  now: Date,
): Promise<PagesState> {
  let state: PagesState = { ...start, boards: { ...start.boards } };
  for (const card of cards) {
    state = { ...state, read: state.read + 1 };
    if (card === undefined) {
      state = { ...state, failed: state.failed + 1 };
      continue;
    }
    const outcome = card ? await importCompany(database, index, card, check, now) : null;
    if (!card || !outcome) {
      state = { ...state, skipped: state.skipped + 1 };
      continue;
    }
    const careers = careersOnCompanySite(card, cleanWebsite(card.website));
    const extras = writePageExtras(database, outcome.companyKey, card, careers, now.toISOString());
    state = {
      ...state,
      added: state.added + (outcome.isNew ? 1 : 0),
      websites: state.websites + (outcome.websiteAdded ? 1 : 0),
      linkedin: state.linkedin + (extras.linkedinAdded ? 1 : 0),
      careers: state.careers + (extras.careersAdded ? 1 : 0),
      boards: outcome.board
        ? {
            ...state.boards,
            [outcome.board.provider]: (state.boards[outcome.board.provider] ?? 0) + 1,
          }
        : state.boards,
    };
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

export function scheduleFreehirePages(
  database: DatabaseSync,
  log: Log,
  env: NodeJS.ProcessEnv,
): () => void {
  if (env.OPENQAREER_FREEHIRE_PAGES_OFF === '1') return () => {};
  const client = new FreehirePagesClient();
  const check = boardCheck(fetch);
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
      const { read, state } = await runPagesTick(database, client, check, pass);
      if (read > 0 && Date.now() - loggedAt >= HOUR_MS) loggedAt = Date.now();
      logTick(log, read, state, client, Date.now() - started, read > 0 && loggedAt >= started);
      next(
        read > 0
          ? BETWEEN_MS
          : state.pausedUntil
            ? Math.max(60_000, Date.parse(state.pausedUntil) - Date.now())
            : DONE_MS,
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
  next(FIRST_RUN_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
