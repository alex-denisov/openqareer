import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { PLACEMENT_TABLES } from '../placement/placementSchema';

/**
 * B643: a careers page from the directory that is not a vacancies page or is
 * closed to us stops being polled and counted. The pass walks the
 * `src-company-site-*` poll states by key in short chunks; a drop clears
 * `careers_url`, marks the site placement `gone` and keeps the old address in
 * `evidence.careersUrlDropped`, so site discovery does not offer it again.
 * A page that ever gave items is never touched. A second pass changes nothing.
 */

const SITE_PREFIX = 'src-company-site-';
/** '.' follows '-' in ASCII: the key range of every company-site source. */
const SITE_PREFIX_END = 'src-company-site.';
const MIN_READINGS = 3;
const EMPTY_DAYS = 14;
const DAY_MS = 86_400_000;
const DEFAULT_CHUNK = 200;

export interface SourceStateRow {
  readonly sourceId: string;
  readonly lastStatus: string | null;
  readonly lastErrorMessage: string | null;
  readonly itemsFoundTotal: number;
  readonly observations: string | null;
}

interface Observed {
  readonly firstReadingAt?: string | null;
  readonly lastNonEmptyReadingAt?: string | null;
  readonly windowReadings?: number;
  readonly consecutiveEmptyReadings?: number;
  readonly census?: unknown;
}

function parseObservations(raw: string | null): Observed | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Observed) : undefined;
  } catch {
    return undefined;
  }
}

/** HTTP 4xx/5xx (not 429: that is a backoff, not a verdict), timeout or no answer at all. */
function blockingCause(message: string | null): string | undefined {
  if (!message) return undefined;
  const code = Number(/unreachable: (\d{3})\b/.exec(message)?.[1]);
  if (code >= 400 && code < 600 && code !== 429) return `HTTP ${code}`;
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|CERT_|certificate/i.test(message)) return 'no answer (000)';
  return undefined;
}

/**
 * Pure drop rule. Drop when the source was read at least 3 times, never
 * gave items, and either its last reading failed with HTTP 4xx/5xx, timeout
 * or no answer, or it has stayed at 0 items for 14+ days since the first reading.
 */
export function careersDropReason(row: SourceStateRow, nowMs: number): string | undefined {
  const observed = parseObservations(row.observations);
  if (!observed?.firstReadingAt) return undefined;
  if (row.itemsFoundTotal > 0 || observed.lastNonEmptyReadingAt || observed.census) return undefined;
  const readings = Math.max(observed.windowReadings ?? 0, observed.consecutiveEmptyReadings ?? 0);
  if (readings < MIN_READINGS) return undefined;
  const cause = row.lastStatus === 'error' ? blockingCause(row.lastErrorMessage) : undefined;
  if (cause) return `never gave items in ${readings} readings, last error ${cause}`;
  const days = Math.floor((nowMs - Date.parse(observed.firstReadingAt)) / DAY_MS);
  if (days >= EMPTY_DAYS) return `0 items for ${days} days in ${readings} readings`;
  return undefined;
}

export interface CareersPruneReport {
  readonly done: boolean;
  readonly processed: number;
  readonly dropped: number;
  readonly droppedTotal: number;
  readonly ms: number;
}

interface Drop {
  readonly companyKey: string;
  readonly sourceId: string;
  readonly url: string;
  readonly reason: string;
}

function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export class CareersPrune {
  private readonly chunk: number;
  private readonly now: () => number;
  private cursor = SITE_PREFIX;
  private droppedTotal = 0;
  private statePage: StatementSync | undefined;
  private readonly careersOf: StatementSync;
  private readonly clearCareers: StatementSync;
  private readonly markGone: StatementSync;

  constructor(private readonly database: DatabaseSync, options: { chunk?: number; now?: () => number } = {}) {
    this.chunk = options.chunk ?? DEFAULT_CHUNK;
    this.now = options.now ?? Date.now;
    database.exec(PLACEMENT_TABLES);
    this.careersOf = database.prepare('SELECT careers_url AS url FROM company_directory WHERE company_key = ?');
    this.clearCareers = database.prepare(`UPDATE company_directory SET careers_url = NULL,
        evidence = json_patch(COALESCE(evidence, '{}'), ?), updated_at = ?
      WHERE company_key = ? AND careers_url = ?`);
    this.markGone = database.prepare(`UPDATE company_placement SET health = 'gone', updated_at = ?
      WHERE type = 'employer_site' AND (health IS NULL OR health <> 'gone')
        AND (source_id = ? OR (company_key = ? AND placement_id = ?))`);
  }

  /** Maintenance may start before the API creates the pool tables: prepare on first use. */
  private readPage(): SourceStateRow[] {
    if (!this.statePage) {
      const exists = this.database.prepare(`SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = 'vacancy_source_state'`).get();
      if (!exists) return [];
      this.statePage = this.database.prepare(`SELECT source_id AS sourceId, last_status AS lastStatus, last_error_message AS lastErrorMessage,
          items_found_total AS itemsFoundTotal, observations FROM vacancy_source_state
        WHERE source_id > ? AND source_id < '${SITE_PREFIX_END}' ORDER BY source_id LIMIT ?`);
    }
    return this.statePage.all(this.cursor, this.chunk) as unknown as SourceStateRow[];
  }

  /** Reads outside the transaction; only drops are written, in one short transaction. */
  private findDrops(rows: readonly SourceStateRow[], nowMs: number): Drop[] {
    const drops: Drop[] = [];
    for (const row of rows) {
      const reason = careersDropReason(row, nowMs);
      if (!reason) continue;
      const companyKey = row.sourceId.slice(SITE_PREFIX.length);
      const current = this.careersOf.get(companyKey) as { url: string | null } | undefined;
      if (current?.url) drops.push({ companyKey, sourceId: row.sourceId, url: current.url, reason });
    }
    return drops;
  }

  private write(drops: readonly Drop[], nowMs: number): number {
    const at = new Date(nowMs).toISOString();
    const day = at.slice(0, 10);
    let changed = 0;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const drop of drops) {
        const patch = JSON.stringify({ careersUrl: null, careersUrlDropped: { value: drop.url, how: `B643 ${drop.reason}, dropped on ${day}` } });
        const cleared = Number(this.clearCareers.run(patch, at, drop.companyKey, drop.url).changes);
        if (cleared === 0) continue;
        changed += cleared;
        const host = siteHost(drop.url);
        this.markGone.run(nowMs, drop.sourceId, drop.companyKey, host ? `site:${host}` : '');
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return changed;
  }

  /** One chunk; `done` ends the pass and the next call starts a new one. */
  step(): CareersPruneReport {
    const startedAt = this.now();
    const rows = this.readPage();
    const last = rows.at(-1);
    if (last) this.cursor = last.sourceId;
    const drops = this.findDrops(rows, startedAt);
    const dropped = drops.length > 0 ? this.write(drops, startedAt) : 0;
    this.droppedTotal += dropped;
    const done = rows.length < this.chunk;
    const report = { done, processed: rows.length, dropped, droppedTotal: this.droppedTotal, ms: this.now() - startedAt };
    if (done) {
      this.cursor = SITE_PREFIX;
      this.droppedTotal = 0;
    }
    return report;
  }
}

export const CAREERS_PRUNE_TICK_BUDGET_MS = 300;
export const CAREERS_PRUNE_PASS_PAUSE_MS = 6 * 60 * 60_000;

/** Maintenance tick: chunks within 300 ms, then a 6 h pause after a pass. */
export class CareersPruneTicker {
  private nextPassAt = 0;

  constructor(
    private readonly prune: Pick<CareersPrune, 'step'>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Report of a finished pass, otherwise `undefined`. */
  tick(): CareersPruneReport | undefined {
    const startedAt = this.now();
    if (startedAt < this.nextPassAt) return undefined;
    while (this.now() - startedAt < CAREERS_PRUNE_TICK_BUDGET_MS) {
      const report = this.prune.step();
      if (report.done) {
        this.nextPassAt = this.now() + CAREERS_PRUNE_PASS_PAUSE_MS;
        return report;
      }
    }
    return undefined;
  }
}
