/**
 * Gradual opening of cards to search (05.11).
 *
 * Salary stopped being a condition: Google only recommends `baseSalary`. That
 * opens tens of thousands of cards at once, and Googlebot should not meet them
 * all in a day, so a card without a stated salary enters through this table, a
 * capped number a day in portions, freshest day first and the longest text within a day.
 * Once in, a card stays while it is live and its text exists.
 *
 * Text may lie only in the pool: hh.ru search rows have an empty
 * `catalog_entries.summary` and the loaded text in `payload.fullDescription`.
 * The rule reads the same text the page shows; no model is involved.
 *
 * A cluster with Himalayas in it, or with unknown sources, does not enter
 * (owner's decision 04.11: their terms forbid passing jobs to search engines).
 */
import type { DatabaseSync } from 'node:sqlite';
import { PRIVATE_EMPLOYER } from '../../shared/privateEmployer';
import { hasPostingLocation } from '../vacancies/vacancyCatalogPage';
import { CARD_SEEN_WITHIN_DAYS, INDEXED_CARD_SUMMARY_MIN } from './catalogIndexing';
import { CATALOG_RU_SUMMARY_VERSION } from './catalogRuSummary';
import { CATALOG_RU_SUMMARIES_TABLE_SQL } from './catalogRuSummaryStore';
import { SEARCH_RESTRICTED_JSON_NEEDLES } from './searchRestrictedSources';

export const CATALOG_CARD_ROLLOUT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_card_rollout (
  cluster_id TEXT PRIMARY KEY,
  admitted_ms INTEGER NOT NULL,
  text_length INTEGER NOT NULL
) STRICT, WITHOUT ROWID`;

/** New cards a day; `OPENQAREER_CARD_ROLLOUT_DAILY_CAP` overrides, 0 stops new ones. */
export const CARD_ROLLOUT_DAILY_CAP_DEFAULT = 5_000;
/**
 * The day's cap is spent in portions, so a vacancy posted today waits hours for
 * the next portion, not a day behind a quota spent at once; the scan takes ~30 s.
 */
const PORTIONS_A_DAY = 4;
const PORTION_INTERVAL_MS = 6 * 3_600_000;
const POOL_ID_FROM = 'cluster-'.length + 1;
const DAY_MS = 86_400_000;

export function cardRolloutDailyCap(raw: string | undefined): number {
  return raw !== undefined && /^\d+$/u.test(raw) ? Number(raw) : CARD_ROLLOUT_DAILY_CAP_DEFAULT;
}

export interface CardRolloutReport {
  readonly admitted: number;
  readonly dropped: number;
}

/** The first non-empty of the texts the page picks (`catalogSummarySourceText`). */
const TEXT_LENGTH_SQL = `length(coalesce(
  nullif(trim(json_extract(p.payload, '$.fullDescription')), ''),
  nullif(trim(json_extract(p.payload, '$.description')), ''),
  trim(e.summary)))`;

/** The card lost its text: no catalog entry, or the pool row expired and the snippet is too short. */
const LOST_TEXT_SQL = `FROM catalog_card_rollout r
   LEFT JOIN catalog_entries e ON e.cluster_id = r.cluster_id
   LEFT JOIN vacancy_pool_index i ON i.id = substr(r.cluster_id, ${POOL_ID_FROM})
  WHERE (e.cluster_id IS NULL
     OR (coalesce(i.expired, 1) = 1 AND length(trim(e.summary)) < ?))`;
/** Cards read and deleted per window; each DELETE is a few-millisecond write. */
const DROP_WINDOW = 500;

/**
 * B761 23.11: one DELETE with this scan as a subquery held the write lock 8.7 s
 * on prod, longer than busy_timeout. Now the scan reads windows by key outside
 * any transaction, and each DELETE names only the window's ids, re-checking the
 * condition for them so a card that got its text back in between stays.
 */
async function dropWithoutText(
  database: DatabaseSync,
  pause: () => Promise<void>,
): Promise<number> {
  const window = database.prepare(
    `SELECT r.cluster_id AS id ${LOST_TEXT_SQL} AND r.cluster_id > ?
      ORDER BY r.cluster_id LIMIT ${DROP_WINDOW}`,
  );
  let dropped = 0;
  let cursor = '';
  for (;;) {
    const ids = (window.all(INDEXED_CARD_SUMMARY_MIN, cursor) as Array<{ id: string }>).map(
      (row) => row.id,
    );
    if (ids.length > 0) dropped += deleteLostText(database, ids);
    if (ids.length < DROP_WINDOW) break;
    cursor = ids[ids.length - 1]!;
    // B761 23.11: 73 тыс. карточек подряд держали цикл 5–8 с на каждом проходе карт сайта.
    await pause();
  }
  return dropped;
}

function deleteLostText(database: DatabaseSync, ids: readonly string[]): number {
  const placeholders = ids.map(() => '?').join(', ');
  return Number(
    database
      .prepare(
        `DELETE FROM catalog_card_rollout WHERE cluster_id IN (
           SELECT r.cluster_id ${LOST_TEXT_SQL} AND r.cluster_id IN (${placeholders}))`,
      )
      .run(INDEXED_CARD_SUMMARY_MIN, ...ids).changes,
  );
}

export interface CandidateRow {
  readonly cluster_id: string;
  readonly title: string;
  readonly location: string | null;
  readonly is_remote: number;
  readonly text_length: number;
}

function candidates(database: DatabaseSync, now: Date): CandidateRow[] {
  const restricted = SEARCH_RESTRICTED_JSON_NEEDLES.map(() => 'instr(c.cluster_json, ?) > 0').join(
    ' OR ',
  );
  return database
    .prepare(
      `SELECT * FROM (
         SELECT e.cluster_id, e.title, e.location, e.is_remote, e.published_ms, e.entry_key,
                ${TEXT_LENGTH_SQL} AS text_length
           FROM catalog_entries e
           JOIN vacancy_clusters c ON c.id = e.cluster_id
           LEFT JOIN vacancy_pool_index i
             ON i.id = substr(e.cluster_id, ${POOL_ID_FROM}) AND i.expired = 0
           LEFT JOIN vacancy_pool p ON p.id = i.id
          WHERE e.status = 'active' AND e.path <> '' AND e.last_seen_ms >= ?
            AND trim(e.company) NOT IN ('', ?) AND e.role_slug IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM catalog_card_rollout r WHERE r.cluster_id = e.cluster_id)
            AND NOT (e.salary_label GLOB '*[1-9]*' AND coalesce(
                  length(trim(e.summary)) >= ?
                  OR EXISTS (SELECT 1 FROM catalog_ru_summaries s
                              WHERE s.cluster_id = e.cluster_id
                                AND s.status = 'ready' AND s.version = ?), 0))
            AND NOT (${restricted}))
        WHERE text_length >= ?
        ORDER BY published_ms / ${DAY_MS} DESC, text_length DESC, entry_key ASC`,
    )
    .all(
      now.getTime() - CARD_SEEN_WITHIN_DAYS * DAY_MS,
      PRIVATE_EMPLOYER,
      INDEXED_CARD_SUMMARY_MIN,
      CATALOG_RU_SUMMARY_VERSION,
      ...SEARCH_RESTRICTED_JSON_NEEDLES,
      INDEXED_CARD_SUMMARY_MIN,
    ) as unknown as CandidateRow[];
}

/**
 * The portion the scan picks: freshest day first, the longest text within a day, only cards
 * with a posting location. Pure read — the heavy-read thread runs it on its own connection.
 */
export function chooseCardRolloutCandidates(
  database: DatabaseSync,
  now: Date,
  quota: number,
): CandidateRow[] {
  const chosen: CandidateRow[] = [];
  for (const row of candidates(database, now)) {
    if (chosen.length >= quota) break;
    const entry = { title: row.title, ...(row.location ? { location: row.location } : {}) };
    // Without a location JobPosting is not built (`postingLocation`), and it is required.
    if (hasPostingLocation(entry, row.is_remote === 1)) chosen.push(row);
  }
  return chosen;
}

export interface CardRolloutOptions {
  /** B761: the scan held the loop 135–230 s on prod; maintenance runs it in the heavy-read thread. */
  readonly choose?: (quota: number) => Promise<readonly CandidateRow[]>;
  readonly pause?: () => Promise<void>;
}

const yieldToLoop = () => new Promise<void>((done) => setImmediate(done));

/** One step, run before the sitemap files. Between portions the candidate scan is skipped. */
export async function admitCardRollout(
  database: DatabaseSync,
  now: Date,
  dailyCap: number,
  options: CardRolloutOptions = {},
): Promise<CardRolloutReport> {
  database.exec(CATALOG_CARD_ROLLOUT_TABLE_SQL);
  database.exec(CATALOG_RU_SUMMARIES_TABLE_SQL);
  const dropped = await dropWithoutText(database, options.pause ?? yieldToLoop);
  const { used, latest } = database
    .prepare(
      `SELECT count(*) AS used, max(admitted_ms) AS latest
         FROM catalog_card_rollout WHERE admitted_ms > ?`,
    )
    .get(now.getTime() - DAY_MS) as { used: number; latest: number | null };
  if (latest !== null && now.getTime() - latest < PORTION_INTERVAL_MS) {
    return { admitted: 0, dropped };
  }
  const quota = Math.min(dailyCap - used, Math.ceil(dailyCap / PORTIONS_A_DAY));
  if (quota <= 0) return { admitted: 0, dropped };

  const chosen = options.choose
    ? await options.choose(quota)
    : chooseCardRolloutCandidates(database, now, quota);
  // The thread reads a snapshot: a card admitted meanwhile is skipped, not a failure.
  const insert = database.prepare(
    'INSERT OR IGNORE INTO catalog_card_rollout (cluster_id, admitted_ms, text_length) VALUES (?, ?, ?)',
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of chosen) insert.run(row.cluster_id, now.getTime(), row.text_length);
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { admitted: chosen.length, dropped };
}
