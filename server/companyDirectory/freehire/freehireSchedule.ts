/**
 * B641: maintenance step — freehire.me companies, largest job_count first, a page of 50
 * per tick, one request at a time (~2/s). The offset and running totals live in
 * freehire_import_state, so a restart continues where it stopped.
 * Rollback: OPENQAREER_FREEHIRE_IMPORT_OFF=1. Cap: OPENQAREER_FREEHIRE_MAX_COMPANIES (default 60 000).
 */
import type { DatabaseSync } from 'node:sqlite';
import { FreehireClient } from './freehireClient';
import { boardCheck, importCompany, loadDirectoryIndex, type BoardCheck } from './freehireImport';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const PAGE = 50;
const FIRST_RUN_MS = 9 * 60_000;
const BETWEEN_MS = 5_000;
const DONE_MS = 24 * 60 * 60_000;
const FAILED_MS = 10 * 60_000;
export const DEFAULT_MAX_COMPANIES = 60_000;

export interface FreehireTotals {
  offset: number;
  read: number;
  added: number;
  websites: number;
  boards: Record<string, number>;
}

const STATE_SQL = `CREATE TABLE IF NOT EXISTS freehire_import_state (id INTEGER PRIMARY KEY CHECK (id = 1), totals TEXT NOT NULL, updated_at TEXT NOT NULL)`;

export function readTotals(database: DatabaseSync): FreehireTotals {
  database.exec(STATE_SQL);
  const row = database.prepare('SELECT totals FROM freehire_import_state WHERE id = 1').get() as { totals: string } | undefined;
  const empty: FreehireTotals = { offset: 0, read: 0, added: 0, websites: 0, boards: {} };
  if (!row) return empty;
  try {
    return { ...empty, ...(JSON.parse(row.totals) as Partial<FreehireTotals>) };
  } catch {
    return empty;
  }
}

function saveTotals(database: DatabaseSync, totals: FreehireTotals, now: Date): void {
  database
    .prepare(
      `INSERT INTO freehire_import_state (id, totals, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET totals = excluded.totals, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(totals), now.toISOString());
}

/** One page; returns read = 0 once the cap or the end of the list is reached. */
export async function runFreehireTick(
  database: DatabaseSync,
  client: FreehireClient,
  check: BoardCheck,
  maxCompanies: number,
  now: () => Date = () => new Date(),
): Promise<{ read: number; totals: FreehireTotals }> {
  const totals = readTotals(database);
  if (totals.offset >= maxCompanies) return { read: 0, totals };
  const { items } = await client.listCompanies(totals.offset, PAGE);
  if (items.length === 0) return { read: 0, totals };
  const index = loadDirectoryIndex(database);
  let next: FreehireTotals = { ...totals, boards: { ...totals.boards } };
  for (const item of items) {
    const card = await client.companyCard(item.slug);
    next = { ...next, read: next.read + 1 };
    if (!card) continue;
    const outcome = await importCompany(database, index, card, check, now());
    if (!outcome) continue;
    next = {
      ...next,
      added: next.added + (outcome.isNew ? 1 : 0),
      websites: next.websites + (outcome.websiteAdded ? 1 : 0),
      boards: outcome.board
        ? { ...next.boards, [outcome.board.provider]: (next.boards[outcome.board.provider] ?? 0) + 1 }
        : next.boards,
    };
  }
  next = { ...next, offset: totals.offset + items.length };
  saveTotals(database, next, now());
  return { read: items.length, totals: next };
}

export function scheduleFreehireImport(database: DatabaseSync, log: Log, env: NodeJS.ProcessEnv): () => void {
  if (env.OPENQAREER_FREEHIRE_IMPORT_OFF === '1') return () => {};
  const maxCompanies = Number(env.OPENQAREER_FREEHIRE_MAX_COMPANIES) || DEFAULT_MAX_COMPANIES;
  const client = new FreehireClient();
  const check = boardCheck(fetch);
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const { read, totals } = await runFreehireTick(database, client, check, maxCompanies);
      if (read > 0) log.info({ ...totals, boards: JSON.stringify(totals.boards), gapMs: client.currentGapMs }, 'freehire-import-tick');
      next(read === 0 ? DONE_MS : BETWEEN_MS);
    } catch (error: unknown) {
      log.error({ errorName: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : '' }, 'freehire-import-failed');
      next(FAILED_MS);
    }
  };
  next(FIRST_RUN_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
