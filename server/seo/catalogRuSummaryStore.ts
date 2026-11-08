/**
 * Storage of the Russian card summaries (`catalogRuSummary.ts`).
 *
 * One row per catalog card, bound to the hash of the text it was written from
 * and to the prompt version. The maintenance process writes; the web server
 * reads one row per card page. Candidates are the cards that can be indexed
 * (a known salary, employer, role, seen within 14 days), newest first.
 */
import type { DatabaseSync } from 'node:sqlite';
import { CARD_SEEN_WITHIN_DAYS } from './catalogIndexing';
import {
  catalogSummarySourceText,
  readStoredCatalogRuSummary,
  type CatalogRuSummary,
} from './catalogRuSummary';

export const CATALOG_RU_SUMMARIES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_ru_summaries (
  cluster_id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'thin', 'failed')),
  summary_json TEXT,
  model TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_ms INTEGER NOT NULL DEFAULT 0,
  checked_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL
) STRICT`;

/**
 * A card whose text has not changed is re-read this often to notice a rewrite.
 * Until then a rewritten card hides its summary on the page but stays in the sitemap.
 */
export const SUMMARY_RECHECK_MS = 86_400_000;
/** After this many unusable answers for the same text the card waits for a new text or version. */
export const SUMMARY_MAX_ATTEMPTS = 3;
/**
 * Owner 08.11: summaries only for hh.ru and company/ATS boards; aggregator cards copy other sites and
 * do not earn the spend. Names as `catalog_entries.source_name` stores them on prod.
 */
export const SUMMARY_SKIPPED_AGGREGATORS: readonly string[] = [
  'Himalayas (JSON API)',
  'Indeed',
  'LinkedIn',
  'The Muse',
  'Jobicy',
  'Arbeitnow (Германия и EU)',
  'We Work Remotely',
  'Remotive (Global Remote)',
  'Get on Board (LATAM)',
];
const AGGREGATOR_PLACEHOLDERS = SUMMARY_SKIPPED_AGGREGATORS.map(() => '?').join(', ');
const SUMMARY_RETRY_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

export type CatalogRuSummaryStatus = 'ready' | 'thin' | 'failed';

export interface CatalogRuSummaryRow {
  readonly clusterId: string;
  readonly sourceHash: string;
  readonly version: number;
  readonly status: CatalogRuSummaryStatus;
  readonly attempts: number;
  readonly nextAttemptMs: number;
}

export interface CatalogRuSummaryCandidate {
  readonly clusterId: string;
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly isRemote: boolean;
  /** The catalog snippet: the page's text when the pool row has none. */
  readonly snippet: string;
  readonly stored?: CatalogRuSummaryRow;
}

interface CandidateRecord {
  cluster_id: string;
  title: string;
  company: string;
  location: string | null;
  is_remote: number;
  summary: string;
  source_hash: string | null;
  version: number | null;
  status: CatalogRuSummaryStatus | null;
  attempts: number | null;
  next_attempt_ms: number | null;
}

/** A pool row id from a catalog cluster id, the same rule the card page uses. */
function poolIdOf(clusterId: string): string | undefined {
  return clusterId.startsWith('cluster-') ? clusterId.slice('cluster-'.length) : undefined;
}

export class CatalogRuSummaryStore {
  constructor(private readonly database: DatabaseSync) {}

  ensureTable(): void {
    this.database.exec(CATALOG_RU_SUMMARIES_TABLE_SQL);
  }

  /** Cards to write, re-check or retry, newest postings first. */
  candidates(now: number, version: number, limit: number): CatalogRuSummaryCandidate[] {
    const rows = this.database
      .prepare(
        `SELECT c.cluster_id, c.title, c.company, c.location, c.is_remote, c.summary,
                s.source_hash, s.version, s.status, s.attempts, s.next_attempt_ms
           FROM catalog_entries c
           LEFT JOIN catalog_ru_summaries s ON s.cluster_id = c.cluster_id
          WHERE c.status = 'active' AND c.path <> ''
            AND c.salary_label IS NOT NULL AND c.salary_label GLOB '*[1-9]*'
            AND trim(c.company) <> '' AND c.role_slug IS NOT NULL
            AND c.last_seen_ms >= ?
            AND c.source_name NOT IN (${AGGREGATOR_PLACEHOLDERS})
            AND (s.cluster_id IS NULL OR s.version <> ? OR s.checked_ms < ?
                 OR (s.status = 'failed' AND s.attempts < ? AND s.next_attempt_ms <= ?))
          ORDER BY c.published_ms DESC, c.entry_key ASC
          LIMIT ?`,
      )
      .all(
        now - CARD_SEEN_WITHIN_DAYS * DAY_MS,
        ...SUMMARY_SKIPPED_AGGREGATORS,
        version,
        now - SUMMARY_RECHECK_MS,
        SUMMARY_MAX_ATTEMPTS,
        now,
        limit,
      ) as unknown as CandidateRecord[];
    return rows.map((row) => ({
      clusterId: row.cluster_id,
      title: row.title,
      company: row.company,
      ...(row.location ? { location: row.location } : {}),
      isRemote: row.is_remote === 1,
      snippet: row.summary,
      ...(row.source_hash !== null
        ? {
            stored: {
              clusterId: row.cluster_id,
              sourceHash: row.source_hash,
              version: row.version ?? 0,
              status: row.status ?? 'failed',
              attempts: row.attempts ?? 0,
              nextAttemptMs: row.next_attempt_ms ?? 0,
            },
          }
        : {}),
    }));
  }

  /** The text the card page shows: the pool row's full text, its description, else the snippet. */
  sourceText(candidate: Pick<CatalogRuSummaryCandidate, 'clusterId' | 'snippet'>): string {
    const poolId = poolIdOf(candidate.clusterId);
    const row = poolId
      ? // Only a live row, as the page's `getVacancy` reads: an expired one leaves the page on the snippet.
        (this.database
          .prepare(
            `SELECT p.payload FROM vacancy_pool p JOIN vacancy_pool_index i ON i.id = p.id
              WHERE p.id = ? AND i.expired = 0`,
          )
          .get(poolId) as { payload: string } | undefined)
      : undefined;
    let payload: { fullDescription?: unknown; description?: unknown } = {};
    try {
      payload = row ? (JSON.parse(row.payload) as typeof payload) : {};
    } catch {
      payload = {};
    }
    const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
    return catalogSummarySourceText(
      text(payload.fullDescription),
      text(payload.description),
      candidate.snippet,
    );
  }

  /** The text is unchanged: only the time of the check moves. */
  touch(clusterId: string, now: number): void {
    this.database
      .prepare('UPDATE catalog_ru_summaries SET checked_ms = ? WHERE cluster_id = ?')
      .run(now, clusterId);
  }

  saveReady(
    clusterId: string,
    sourceHash: string,
    version: number,
    summary: CatalogRuSummary,
    model: string,
    now: number,
  ): void {
    this.upsert(clusterId, sourceHash, version, 'ready', JSON.stringify(summary), model, 0, 0, now);
  }

  saveThin(clusterId: string, sourceHash: string, version: number, now: number): void {
    this.upsert(clusterId, sourceHash, version, 'thin', null, null, 0, 0, now);
  }

  /** An unusable answer: attempts count per text, a new text starts from zero. */
  saveFailed(
    clusterId: string,
    sourceHash: string,
    version: number,
    previous: CatalogRuSummaryRow | undefined,
    now: number,
  ): void {
    const sameText = previous?.sourceHash === sourceHash && previous.version === version;
    const attempts = (sameText ? previous.attempts : 0) + 1;
    this.upsert(
      clusterId,
      sourceHash,
      version,
      'failed',
      null,
      null,
      attempts,
      now + SUMMARY_RETRY_MS,
      now,
    );
  }

  /** The page's read: the summary only while it was written from this text and this version. */
  readReady(clusterId: string, sourceHash: string, version: number): CatalogRuSummary | undefined {
    const row = this.database
      .prepare(
        `SELECT summary_json FROM catalog_ru_summaries
          WHERE cluster_id = ? AND source_hash = ? AND version = ? AND status = 'ready'`,
      )
      .get(clusterId, sourceHash, version) as { summary_json: string | null } | undefined;
    return row?.summary_json ? readStoredCatalogRuSummary(row.summary_json) : undefined;
  }

  countReady(version: number): number {
    const row = this.database
      .prepare(
        `SELECT count(*) AS count FROM catalog_ru_summaries WHERE status = 'ready' AND version = ?`,
      )
      .get(version) as { count: number };
    return row.count;
  }

  private upsert(
    clusterId: string,
    sourceHash: string,
    version: number,
    status: CatalogRuSummaryStatus,
    summaryJson: string | null,
    model: string | null,
    attempts: number,
    nextAttemptMs: number,
    now: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO catalog_ru_summaries
           (cluster_id, source_hash, version, status, summary_json, model, attempts, next_attempt_ms, checked_ms, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cluster_id) DO UPDATE SET
           source_hash = excluded.source_hash, version = excluded.version, status = excluded.status,
           summary_json = excluded.summary_json, model = excluded.model, attempts = excluded.attempts,
           next_attempt_ms = excluded.next_attempt_ms, checked_ms = excluded.checked_ms,
           updated_at = excluded.updated_at`,
      )
      .run(
        clusterId,
        sourceHash,
        version,
        status,
        summaryJson,
        model,
        attempts,
        nextAttemptMs,
        now,
        new Date(now).toISOString(),
      );
  }
}
