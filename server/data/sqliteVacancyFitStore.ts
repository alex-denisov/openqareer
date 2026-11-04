import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { LEGACY_VACANCY_FIT_ALGORITHM_VERSIONS, VACANCY_FIT_ALGORITHM_VERSION, type VacancyFitResult } from '../../shared/vacancyFit';
import { evaluateVacancyFit, vacancyFitFingerprint, type VacancyFitFactScope, type VacancyFitInput } from '../domain/vacancyFit';
import { SealedText } from './sealedText';
import { addLateColumns } from './sqliteLateColumn';
import { MECHANICS_REQUEUE_REVISION } from './sqliteVacancyRequirementsStore';

export interface VacancyFitJob {
  readonly key: string;
  readonly leaseToken: string;
  readonly leaseUntil: string;
  readonly attempts: number;
  readonly input: VacancyFitInput;
}
export type VacancyFitJobState = 'pending' | 'leased' | 'completed' | 'failed' | 'retrying';
export type VacancyFitDeferOutcome = 'deferred' | 'failed' | 'lost';

/** A job waiting for requirements gives up after this many pauses (~30 min at the default pause). */
export const VACANCY_FIT_MAX_DEFERS = 30;
const DEFER_MS = 60_000;
/** The deploy that left requirement jobs completed without their cache rows (01.11, #283). */
const ORPHANED_REQUIREMENTS_SINCE = '2026-11-01T21:00:00.000Z';
/** One claim moves at most this many rows of another release before it returns empty-handed. */
const MAX_REKEYS_PER_CLAIM = 50;
/** Rows one worker-start requeue write touches: each holds the write lock a few ms per row. */
const REQUEUE_BATCH = 20;
const RETRY_BASE_MS = 30_000;
const LATE_COLUMNS = [
  ['requested_at', 'TEXT'],
  ['defers', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_error', 'TEXT'],
  ['requeue_revision', 'INTEGER'],
] as const;
/** Which model answered: outside the sealed result, so it never reaches the candidate's screen. */
const LATE_CACHE_COLUMNS = [['answered_by', 'TEXT'], ['fallback_recount_at', 'TEXT']] as const;

const VERIFIED_FIELDS = ['gates', 'assessments', 'status', 'dataState', 'coveragePercent', 'coverage', 'conditionCoverage', 'requiredCoverage', 'reason'] as const;
interface JobRow { cache_key: string; input_cipher: string; lease_token: string; lease_until: string; attempts: number }

/** Candidate facts/results are encrypted; all tenant correlation indexes use keyed HMAC. */
/** `backgroundRank` — position in the background sweep; absent for work a candidate is looking at. */
export interface FitEnqueueOptions { readonly backgroundRank?: number }

/**
 * The sweep yields to every page request (B580): the queue claims the newest `requested_at` first,
 * so background rows get a stamp in 2000 that only their relevance rank orders — the most relevant
 * rows of every candidate go first, and a later sweep chunk never jumps a visible page.
 */
const BACKGROUND_BASE_MS = Date.UTC(2000, 0, 1) + 1_000_000_000;

function requestedAtFor(now: string, options: FitEnqueueOptions): string {
  if (options.backgroundRank === undefined) return now;
  return new Date(BACKGROUND_BASE_MS - Math.max(0, Math.floor(options.backgroundRank))).toISOString();
}

export class SqliteVacancyFitStore {
  private readonly cachedIdsMemo = new Map<string, { readonly ids: ReadonlySet<string>; readonly count: number; readonly last: number }>();

  constructor(private readonly database: DatabaseSync, private readonly sealedText: SealedText) {
    database.exec(`CREATE TABLE IF NOT EXISTS vacancy_fit_cache (
      cache_key TEXT PRIMARY KEY, candidate_key TEXT NOT NULL,
      result_cipher TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vacancy_fit_cache_candidate ON vacancy_fit_cache(candidate_key);
    CREATE TABLE IF NOT EXISTS vacancy_fit_queue (
      cache_key TEXT PRIMARY KEY, candidate_key TEXT NOT NULL, input_cipher TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','leased','completed','failed')),
      lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vacancy_fit_queue_claim ON vacancy_fit_queue(status,lease_until,created_at);
    CREATE INDEX IF NOT EXISTS vacancy_fit_queue_candidate ON vacancy_fit_queue(candidate_key);
    CREATE TABLE IF NOT EXISTS vacancy_fit_latest (
      latest_key TEXT PRIMARY KEY, candidate_key TEXT NOT NULL,
      result_cipher TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vacancy_fit_latest_candidate ON vacancy_fit_latest(candidate_key);`);
    addLateColumns(database, 'vacancy_fit_queue', LATE_COLUMNS);
    addLateColumns(database, 'vacancy_fit_cache', LATE_CACHE_COLUMNS);
  }

  private candidateKey(candidateId: string): string {
    return this.sealedText.indexToken('vacancy-fit-candidate', candidateId);
  }
  /** One row per vacancy and candidate, whatever the profile: the percent shown while a new one is counted. */
  private latestKey(candidateId: string, vacancyId: string): string {
    return this.sealedText.indexToken(`vacancy-fit-latest:${candidateId}`, vacancyId);
  }
  cacheKey(input: VacancyFitInput, algorithmVersion = VACANCY_FIT_ALGORITHM_VERSION, factScope: VacancyFitFactScope = 'evidence'): string {
    const fingerprint = vacancyFitFingerprint(input, algorithmVersion, factScope);
    return this.sealedText.indexToken(`vacancy-fit:${input.candidateId}`, JSON.stringify(fingerprint));
  }

  /** `retrying` is a pending job whose last model call failed: the row says so instead of «в очереди». */
  getJobState(input: VacancyFitInput): VacancyFitJobState | undefined {
    return this.getJobStatus(input)?.state;
  }

  /** The state with the error class of the last attempt: a `failed` row says why (B562-r). */
  getJobStatus(input: VacancyFitInput): { readonly state: VacancyFitJobState; readonly lastError: string | null } | undefined {
    const row = this.database.prepare('SELECT status,last_error FROM vacancy_fit_queue WHERE cache_key=? AND candidate_key=?')
      .get(this.cacheKey(input), this.candidateKey(input.candidateId)) as { status: VacancyFitJobState; last_error: string | null } | undefined;
    if (!row) return undefined;
    return { state: row.status === 'pending' && row.last_error ? 'retrying' : row.status, lastError: row.last_error };
  }

  /** A current-version row exists under the input's key; nothing is decrypted. */
  hasCache(input: VacancyFitInput): boolean {
    return this.database.prepare('SELECT 1 FROM vacancy_fit_cache WHERE cache_key = ? AND candidate_key = ?')
      .get(this.cacheKey(input), this.candidateKey(input.candidateId)) !== undefined;
  }

  getCache(input: VacancyFitInput): VacancyFitResult | undefined {
    const current = this.readCache(input);
    if (current) return current;
    // B580: the stamp formula changed; a result under an earlier stamp moves to the new key once,
    // instead of 42K model calls on deploy. Earlier keys hashed every memory row (B580-r).
    // 29.10: the B580-r stamp had role names in it and keyed evidence facts, like the current one.
    const earlier = ([[input.roleScopedProfileContextHash, 'evidence'], [input.previousProfileContextHash, 'all'], [input.legacyProfileContextHash, 'all']] as const)
      .filter((entry): entry is readonly [string, VacancyFitFactScope] => Boolean(entry[0]))
      .map(([stamp, scope]) => this.readCache({ ...input, profileContextHash: stamp }, scope))
      .find(Boolean);
    if (!earlier) return undefined;
    this.putCache(input, earlier, earlier.calculatedAt);
    return earlier;
  }

  private readCache(input: VacancyFitInput, factScope: VacancyFitFactScope = 'evidence'): VacancyFitResult | undefined {
    const key = this.cacheKey(input, VACANCY_FIT_ALGORITHM_VERSION, factScope);
    const row = this.database.prepare('SELECT result_cipher FROM vacancy_fit_cache WHERE cache_key = ? AND candidate_key = ?').get(key, this.candidateKey(input.candidateId)) as { result_cipher: string } | undefined;
    if (!row) return undefined;
    try {
      const result = JSON.parse(this.sealedText.open(row.result_cipher, key)) as VacancyFitResult;
      // The percent policy may change without a new algorithm version (B510-r): the verified
      // evidence stays, the numbers are derived again, so no model call is repeated.
      return this.validateResult(input, result, ['gates', 'assessments']);
    } catch { return undefined; }
  }

  /**
   * Вакансии, по которым у кандидата есть сохранённый результат, — одним
   * чтением. Сортировка пула считает точный разбор только для них, а не для
   * тысяч вакансий без результата. Свежесть результата проверяет getCache.
   */
  cachedVacancyIds(candidateId: string): ReadonlySet<string> {
    const candidateKey = this.candidateKey(candidateId);
    const stat = this.database.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(rowid), 0) AS last FROM vacancy_fit_cache WHERE candidate_key = ?')
      .get(candidateKey) as { count: number; last: number };
    const known = this.cachedIdsMemo.get(candidateKey);
    // Prod 02.11: every list page opened every stored result (seconds of CPU on the event loop).
    // Rows are only added or replaced (a new rowid); only a delete forces a full read.
    const since = known && known.last <= stat.last ? known.last : 0;
    const rows = this.database.prepare('SELECT cache_key, result_cipher FROM vacancy_fit_cache WHERE candidate_key = ? AND rowid > ?')
      .all(candidateKey, since) as { cache_key: string; result_cipher: string }[];
    // Counts that do not add up mean a row was deleted: read all of them again.
    if (since > 0 && known && known.count + rows.length !== stat.count) {
      this.cachedIdsMemo.delete(candidateKey);
      return this.cachedVacancyIds(candidateId);
    }
    // PRB-041: nothing landed — the same set, not a copy of thousands of ids per page read.
    if (since > 0 && known && rows.length === 0) return known.ids;
    const ids = new Set(since > 0 && known ? known.ids : []);
    for (const row of rows) {
      const id = this.openedVacancyId(row, candidateId);
      if (id) ids.add(id);
    }
    this.cachedIdsMemo.set(candidateKey, { ids, count: stat.count, last: stat.last });
    return ids;
  }

  /**
   * Prod 03.11: the first list read of a process opened every stored result of the candidate in
   * one call (~4 s of the event loop, once per deploy). This fills the same memo in rowid order,
   * a batch at a time, letting queued requests run between batches; a partial memo is valid.
   */
  async warmCachedVacancyIds(
    candidateId: string,
    { batch = 200, yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve)) }: { readonly batch?: number; readonly yieldToLoop?: () => Promise<void> } = {},
  ): Promise<void> {
    const candidateKey = this.candidateKey(candidateId);
    const page = this.database.prepare('SELECT rowid AS id, cache_key, result_cipher FROM vacancy_fit_cache WHERE candidate_key = ? AND rowid > ? ORDER BY rowid LIMIT ?');
    for (;;) {
      const known = this.cachedIdsMemo.get(candidateKey);
      const rows = page.all(candidateKey, known?.last ?? 0, batch) as { id: number; cache_key: string; result_cipher: string }[];
      if (rows.length === 0) return;
      const ids = new Set(known?.ids ?? []);
      for (const row of rows) {
        const id = this.openedVacancyId(row, candidateId);
        if (id) ids.add(id);
      }
      this.cachedIdsMemo.set(candidateKey, { ids, count: (known?.count ?? 0) + rows.length, last: rows.at(-1)!.id });
      await yieldToLoop();
      if (rows.length < batch) return;
    }
  }

  private openedVacancyId(row: { cache_key: string; result_cipher: string }, candidateId: string): string | undefined {
    try {
      const result = JSON.parse(this.sealedText.open(row.result_cipher, row.cache_key)) as VacancyFitResult;
      return result.candidateId === candidateId ? result.vacancyId : undefined;
    } catch { return undefined; /* повреждённая строка не даёт вакансии результата */ }
  }


  /**
   * The newest result of an earlier algorithm version, its numbers derived again from its verified
   * evidence: shown as «пересчитывается» while the current version is queued (B562-r).
   */
  getPreviousCache(input: VacancyFitInput): VacancyFitResult | undefined {
    for (const version of LEGACY_VACANCY_FIT_ALGORITHM_VERSIONS) {
      const key = this.cacheKey(input, version);
      const row = this.database.prepare('SELECT result_cipher FROM vacancy_fit_cache WHERE cache_key = ? AND candidate_key = ?').get(key, this.candidateKey(input.candidateId)) as { result_cipher: string } | undefined;
      if (!row) continue;
      try {
        return this.validateResult(input, JSON.parse(this.sealedText.open(row.result_cipher, key)) as VacancyFitResult, ['gates'], version);
      } catch { /* an unreadable older row gives no percent */ }
    }
    return this.getLatest(input);
  }

  /**
   * The last result for this vacancy under any profile (01.11): after a profile edit the row says
   * «пересчитывается» with it instead of «не посчитан». Its evidence is checked against the current
   * profile when it still holds; otherwise the stored numbers are shown as they were computed.
   */
  private getLatest(input: VacancyFitInput): VacancyFitResult | undefined {
    const key = this.latestKey(input.candidateId, input.vacancyId);
    const row = this.database.prepare('SELECT result_cipher FROM vacancy_fit_latest WHERE latest_key = ? AND candidate_key = ?').get(key, this.candidateKey(input.candidateId)) as { result_cipher: string } | undefined;
    if (!row) return undefined;
    try {
      const stored = JSON.parse(this.sealedText.open(row.result_cipher, key)) as VacancyFitResult;
      if (stored.candidateId !== input.candidateId || stored.vacancyId !== input.vacancyId || !Number.isFinite(Date.parse(stored.calculatedAt))) return undefined;
      const rechecked = evaluateVacancyFit({ ...input, assessments: stored.assessments }, stored.calculatedAt);
      return rechecked.status === 'assessed' && (rechecked.coveragePercent ?? 0) >= (stored.coveragePercent ?? 0) ? rechecked : stored;
    } catch { return undefined; }
  }

  putCache(input: VacancyFitInput, result: VacancyFitResult, now = new Date().toISOString(), algorithmVersion = VACANCY_FIT_ALGORITHM_VERSION, answeredBy: string | null = null): void {
    this.validateResult(input, result, VERIFIED_FIELDS, algorithmVersion);
    const key = this.cacheKey(input, algorithmVersion);
    this.database.prepare(`INSERT INTO vacancy_fit_cache(cache_key,candidate_key,result_cipher,updated_at,answered_by) VALUES(?,?,?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET result_cipher=excluded.result_cipher,updated_at=excluded.updated_at,answered_by=excluded.answered_by`).run(key, this.candidateKey(input.candidateId), this.sealedText.seal(JSON.stringify(result), key), now, answeredBy);
    if (result.status !== 'assessed') return;
    const latest = this.latestKey(input.candidateId, input.vacancyId);
    this.database.prepare(`INSERT INTO vacancy_fit_latest(latest_key,candidate_key,result_cipher,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(latest_key) DO UPDATE SET result_cipher=excluded.result_cipher,updated_at=excluded.updated_at WHERE excluded.updated_at>=vacancy_fit_latest.updated_at`).run(latest, this.candidateKey(input.candidateId), this.sealedText.seal(JSON.stringify(result), latest), now);
  }

  /** The model behind a stored result; null when none answered or the row predates this column. */
  answeredBy(input: VacancyFitInput): string | null {
    const row = this.database.prepare('SELECT answered_by FROM vacancy_fit_cache WHERE cache_key=?').get(this.cacheKey(input)) as { answered_by: string | null } | undefined;
    return row?.answered_by ?? null;
  }

  /** Rows a model other than Vertex answered and no pass has taken (05.11). Only these few rows are opened. */
  fallbackRows(): readonly { readonly key: string; readonly candidateId: string; readonly vacancyId: string }[] {
    const rows = this.database.prepare(`SELECT cache_key, result_cipher FROM vacancy_fit_cache
      WHERE answered_by IS NOT NULL AND answered_by NOT LIKE 'vertex %' AND fallback_recount_at IS NULL ORDER BY rowid`).all() as { cache_key: string; result_cipher: string }[];
    return rows.flatMap((row) => {
      try {
        const { candidateId, vacancyId } = JSON.parse(this.sealedText.open(row.result_cipher, row.cache_key)) as VacancyFitResult;
        return [{ key: row.cache_key, candidateId, vacancyId }];
      } catch { return []; /* a damaged row names no vacancy */ }
    });
  }

  /** Written before the call: a marked row is never asked again, whatever becomes of the call. */
  markFallbackRecount(key: string, now = new Date().toISOString()): void {
    this.database.prepare('UPDATE vacancy_fit_cache SET fallback_recount_at=? WHERE cache_key=?').run(now, key);
  }

  /** The gate let no call out: nothing was asked, so the row keeps its turn. */
  releaseFallbackRecount(key: string): void {
    this.database.prepare('UPDATE vacancy_fit_cache SET fallback_recount_at=NULL WHERE cache_key=?').run(key);
  }

  /**
   * Input hash changes naturally enqueue a new job; identical work is idempotent across processes.
   * A repeated request (the candidate opened the page again) moves a waiting job to the front.
   */
  enqueue(input: VacancyFitInput, now = new Date().toISOString(), options: FitEnqueueOptions = {}): { key: string; status: string } {
    const key = this.cacheKey(input);
    const requestedAt = requestedAtFor(now, options);
    this.database.prepare(`INSERT INTO vacancy_fit_queue(cache_key,candidate_key,input_cipher,status,requested_at,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?,?) ON CONFLICT(cache_key) DO UPDATE SET requested_at=excluded.requested_at WHERE status='pending'`)
      .run(key, this.candidateKey(input.candidateId), this.sealedText.seal(JSON.stringify(input), key), requestedAt, now, now);
    const row = this.database.prepare('SELECT status FROM vacancy_fit_queue WHERE cache_key=?').get(key) as { status: string };
    return { key, status: row.status };
  }

  retryFailed(input: VacancyFitInput, now = new Date().toISOString(), options: FitEnqueueOptions = {}): void {
    const key = this.cacheKey(input);
    const requestedAt = requestedAtFor(now, options);
    this.database.prepare(`UPDATE vacancy_fit_queue SET status='pending',input_cipher=?,attempts=0,defers=0,last_error=NULL,
      lease_token=NULL,lease_until=NULL,requested_at=?,updated_at=? WHERE cache_key=? AND candidate_key=? AND status='failed'`)
      .run(this.sealedText.seal(JSON.stringify(input), key), requestedAt, now, key, this.candidateKey(input.candidateId));
  }

  /**
   * 04.11: a job's key holds no requirements and its result's key does, so new requirements under
   * the same text lose the result while the finished job stops `enqueue`. The caller decides that
   * the result is really gone; the row goes back with this input, as `retryFailed` does.
   */
  reviveCompleted(input: VacancyFitInput, now = new Date().toISOString(), options: FitEnqueueOptions = {}): void {
    const key = this.cacheKey(input);
    const requestedAt = requestedAtFor(now, options);
    this.database.prepare(`UPDATE vacancy_fit_queue SET status='pending',input_cipher=?,attempts=0,defers=0,last_error=NULL,
      lease_token=NULL,lease_until=NULL,requested_at=?,updated_at=? WHERE cache_key=? AND candidate_key=? AND status='completed'`)
      .run(this.sealedText.seal(JSON.stringify(input), key), requestedAt, now, key, this.candidateKey(input.candidateId));
  }

  /**
   * One atomic update makes competing workers safe; expired work is retried with a new fencing token.
   * Order: fresh work before work that already waited (deferred or retried), and the most recently
   * requested first — the page the candidate is looking at now. Ordering by created_at alone let one
   * deferred head job be reclaimed on every step while 1229 others were never taken (prod 21.10).
   */
  claim(options: { now?: string; leaseMs?: number } = {}): VacancyFitJob | undefined {
    const now = options.now ?? new Date().toISOString();
    const leaseMs = options.leaseMs ?? 60_000;
    if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('invalid vacancy fit lease');
    const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString();
    for (let rekeyed = 0; rekeyed <= MAX_REKEYS_PER_CLAIM; rekeyed += 1) {
      const token = randomUUID();
      const row = this.database.prepare(`UPDATE vacancy_fit_queue SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
        WHERE cache_key=(SELECT cache_key FROM vacancy_fit_queue WHERE (status='pending' AND (lease_until IS NULL OR lease_until<=?)) OR (status='leased' AND lease_until<=?) ORDER BY (defers>0 OR attempts>0),COALESCE(requested_at,created_at) DESC,cache_key LIMIT 1)
        RETURNING cache_key,input_cipher,lease_token,lease_until,attempts`).get(token, leaseUntil, now, now, now) as JobRow | undefined;
      if (!row) return undefined;
      let input: VacancyFitInput;
      try {
        input = JSON.parse(this.sealedText.open(row.input_cipher, row.cache_key)) as VacancyFitInput;
      } catch {
        this.database.prepare("UPDATE vacancy_fit_queue SET status='failed',input_cipher='',lease_token=NULL,lease_until=NULL WHERE cache_key=? AND lease_token=?").run(row.cache_key, token);
        return undefined;
      }
      if (this.cacheKey(input) === row.cache_key) return { key: row.cache_key, leaseToken: row.lease_token, leaseUntil: row.lease_until, attempts: row.attempts, input };
      this.rekey(row.cache_key, token, input, now);
    }
    return undefined;
  }

  /**
   * A row keyed by another release (fingerprint or algorithm version) is moved to this release's key.
   * Failing it lost every job the new HTTP process queued while the old worker still ran (25.10, B562-r).
   */
  private rekey(key: string, token: string, input: VacancyFitInput, now: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM vacancy_fit_queue WHERE cache_key=? AND lease_token=?').run(key, token);
      this.enqueue(input, now);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  /** A stale worker cannot publish a result after another worker has reclaimed the lease. */
  complete(job: VacancyFitJob, result: VacancyFitResult, now = new Date().toISOString(), resolvedInput: VacancyFitInput = job.input, answeredBy: string | null = null): boolean {
    this.validateResult(resolvedInput, result);
    if (resolvedInput.candidateId !== job.input.candidateId || resolvedInput.vacancyId !== job.input.vacancyId || resolvedInput.description !== job.input.description || JSON.stringify(resolvedInput.facts) !== JSON.stringify(job.input.facts)) throw new Error('vacancy fit resolved input scope mismatch');
    if (this.cacheKey(job.input) !== job.key) return false;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const update = this.database.prepare(`UPDATE vacancy_fit_queue SET status='completed',input_cipher='',lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE cache_key=? AND status='leased' AND lease_token=? AND lease_until>?`).run(now, job.key, job.leaseToken, now);
      if (Number(update.changes) !== 1) { this.database.exec('COMMIT'); return false; }
      this.putCache(resolvedInput, result, now, VACANCY_FIT_ALGORITHM_VERSION, answeredBy);
      this.database.exec('COMMIT');
      return true;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  /** Waiting for requirements is bounded: after VACANCY_FIT_MAX_DEFERS pauses the row fails honestly. */
  defer(job: VacancyFitJob, now = new Date().toISOString(), delayMs = DEFER_MS): VacancyFitDeferOutcome {
    const available = new Date(Date.parse(now) + delayMs).toISOString();
    const update = this.database.prepare(`UPDATE vacancy_fit_queue
      SET status=CASE WHEN defers+1>=? THEN 'failed' ELSE 'pending' END,
        last_error=CASE WHEN defers+1>=? THEN 'requirements_wait_timeout' ELSE last_error END,
        requeue_revision=?,lease_token=NULL,lease_until=?,attempts=MAX(0,attempts-1),defers=defers+1,updated_at=?
      WHERE cache_key=? AND status='leased' AND lease_token=? AND lease_until>? RETURNING status`)
      .get(VACANCY_FIT_MAX_DEFERS, VACANCY_FIT_MAX_DEFERS, MECHANICS_REQUEUE_REVISION, available, now, job.key, job.leaseToken, now) as { status: string } | undefined;
    if (!update) return 'lost';
    return update.status === 'failed' ? 'failed' : 'deferred';
  }

  /** A budget refusal (01.11): the job waits until `until`, keeps its attempts and defers. */
  pause(job: VacancyFitJob, until: string, reason: string, now = new Date().toISOString()): boolean {
    const update = this.database.prepare(`UPDATE vacancy_fit_queue SET status='pending',lease_token=NULL,lease_until=?,attempts=MAX(0,attempts-1),last_error=?,updated_at=?
      WHERE cache_key=? AND status='leased' AND lease_token=? AND lease_until>?`).run(until, reason, now, job.key, job.leaseToken, now);
    return Number(update.changes) === 1;
  }

  /** A retried job waits 30 s, 60 s, 120 s… before the next model call; the reason is an error class only. */
  fail(job: VacancyFitJob, options: { retry?: boolean; now?: string; reason?: string } = {}): boolean {
    const now = options.now ?? new Date().toISOString();
    const reason = options.reason && /^[a-z0-9_:-]{1,80}$/iu.test(options.reason) ? options.reason : 'assessment_failed';
    const available = options.retry ? new Date(Date.parse(now) + RETRY_BASE_MS * 2 ** Math.max(0, job.attempts - 1)).toISOString() : null;
    const update = this.database.prepare(`UPDATE vacancy_fit_queue SET status=?,lease_token=NULL,lease_until=?,last_error=?,requeue_revision=?,updated_at=?
      WHERE cache_key=? AND status='leased' AND lease_token=? AND lease_until>?`).run(options.retry ? 'pending' : 'failed', available, reason, MECHANICS_REQUEUE_REVISION, now, job.key, job.leaseToken, now);
    return Number(update.changes) === 1;
  }

  /**
   * One requeue of failed jobs after a parser upgrade. The request time goes back to creation,
   * so pages the candidate opens now stay ahead; a failure under the current revision stays failed.
   */
  requeueFailedOnce(revision = MECHANICS_REQUEUE_REVISION, now = new Date().toISOString(), limit = Number.POSITIVE_INFINITY): number {
    return this.requeueFound(
      `status='failed' AND input_cipher<>'' AND COALESCE(requeue_revision,1)<?`, [revision],
      `requested_at=created_at,requeue_revision=?,`, [revision], now, limit,
    );
  }

  /** Rows `requeueFailedOnce` has yet to return: a read by status only (an upper bound, no cipher read, no write). */
  countFailedOnce(revision = MECHANICS_REQUEUE_REVISION): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS n FROM vacancy_fit_queue WHERE status='failed' AND COALESCE(requeue_revision,1)<?`).get(revision) as { n: number };
    return row.n;
  }

  countOrphanedRequirementsTimeouts(): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS n FROM vacancy_fit_queue WHERE status='failed' AND last_error='requirements_wait_timeout' AND updated_at>=?`).get(ORPHANED_REQUIREMENTS_SINCE) as { n: number };
    return row.n;
  }

  /**
   * 02.11: fits waited on requirement jobs marked completed without a cache row (fixed in the
   * requirements store). Those that ran out of defers since then go back with their request time.
   */
  requeueOrphanedRequirementsTimeouts(now = new Date().toISOString(), limit = Number.POSITIVE_INFINITY): number {
    return this.requeueFound(
      `status='failed' AND last_error='requirements_wait_timeout' AND input_cipher<>'' AND updated_at>=?`, [ORPHANED_REQUIREMENTS_SINCE],
      '', [], now, limit,
    );
  }

  /**
   * Prod 03.11: as one UPDATE each, the two worker-start requeues scanned 19K failed rows (their
   * ciphers on overflow pages) for 72 s and 30 s under the write lock; every HTTP write waited out
   * its 20 s busy timeout on the event loop. The rows are found by a read, which takes no lock in
   * WAL, and written by rowid in small batches that check the condition again.
   */
  private requeueFound(where: string, whereArgs: readonly SQLInputValue[], set: string, setArgs: readonly SQLInputValue[], now: string, limit = Number.POSITIVE_INFINITY): number {
    if (limit <= 0) return 0;
    const cap = Number.isFinite(limit) ? ' LIMIT ?' : '';
    const capArgs = Number.isFinite(limit) ? [Math.floor(limit)] : [];
    const ids = (this.database.prepare(`SELECT rowid AS id FROM vacancy_fit_queue WHERE ${where} ORDER BY rowid${cap}`).all(...whereArgs, ...capArgs) as { id: number }[]).map((row) => row.id);
    let changed = 0;
    for (let start = 0; start < ids.length; start += REQUEUE_BATCH) {
      const batch = ids.slice(start, start + REQUEUE_BATCH);
      const update = this.database.prepare(`UPDATE vacancy_fit_queue SET status='pending',attempts=0,defers=0,last_error=NULL,
        lease_token=NULL,lease_until=NULL,${set}updated_at=? WHERE rowid IN (${batch.map(() => '?').join(',')}) AND ${where}`)
        .run(...setArgs, now, ...batch, ...whereArgs);
      changed += Number(update.changes);
    }
    return changed;
  }

  /** The newest assessed result of each vacancy of one candidate, to see what a recount would touch. */
  assessedResults(candidateId: string): readonly { readonly key: string; readonly vacancyId: string; readonly percent: number | null; readonly updatedAt: string }[] {
    const rows = this.database.prepare('SELECT cache_key, result_cipher, updated_at FROM vacancy_fit_cache WHERE candidate_key = ?')
      .iterate(this.candidateKey(candidateId)) as Iterable<{ cache_key: string; result_cipher: string; updated_at: string }>;
    const newest = new Map<string, { readonly key: string; readonly vacancyId: string; readonly percent: number | null; readonly updatedAt: string }>();
    for (const row of rows) {
      const result = JSON.parse(this.sealedText.open(row.result_cipher, row.cache_key)) as VacancyFitResult;
      if (result.algorithmVersion !== VACANCY_FIT_ALGORITHM_VERSION) continue;
      const known = newest.get(result.vacancyId);
      if (known && known.updatedAt >= row.updated_at) continue;
      if (result.reason === 'assessed') newest.set(result.vacancyId, { key: row.cache_key, vacancyId: result.vacancyId, percent: result.coveragePercent ?? null, updatedAt: row.updated_at });
      else newest.delete(result.vacancyId);
    }
    return [...newest.values()];
  }

  /**
   * One vacancy's recount without a version change, which would recount everyone (04.11). The job
   * sits under the input as queued (no requirements), the result under the input as resolved: left
   * alone the finished job stops `enqueue` and the row hangs. A job waiting or failed stays. The
   * screen keeps a percent from an earlier version's row, or from `vacancy_fit_latest` without one.
   */
  forgetResult(queued: VacancyFitInput, resolved: VacancyFitInput): { readonly result: boolean; readonly job: boolean } {
    const candidateKey = this.candidateKey(queued.candidateId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare('DELETE FROM vacancy_fit_cache WHERE cache_key=? AND candidate_key=?').run(this.cacheKey(resolved), candidateKey);
      const job = this.database.prepare("DELETE FROM vacancy_fit_queue WHERE cache_key=? AND candidate_key=? AND status='completed'").run(this.cacheKey(queued), candidateKey);
      this.database.exec('COMMIT');
      return { result: Number(result.changes) > 0, job: Number(job.changes) > 0 };
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  deleteCandidate(candidateId: string): void {
    const key = this.candidateKey(candidateId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM vacancy_fit_cache WHERE candidate_key=?').run(key);
      this.database.prepare('DELETE FROM vacancy_fit_queue WHERE candidate_key=?').run(key);
      this.database.prepare('DELETE FROM vacancy_fit_latest WHERE candidate_key=?').run(key);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  private validateResult(input: VacancyFitInput, result: VacancyFitResult, fields: readonly (keyof VacancyFitResult)[] = VERIFIED_FIELDS, algorithmVersion = VACANCY_FIT_ALGORITHM_VERSION): VacancyFitResult {
    if (result.candidateId !== input.candidateId || result.vacancyId !== input.vacancyId || result.algorithmVersion !== algorithmVersion) throw new Error('vacancy fit result scope mismatch');
    if (!Number.isFinite(Date.parse(result.calculatedAt))) throw new Error('invalid vacancy fit result date');
    const checked = evaluateVacancyFit({ ...input, assessments: result.assessments }, result.calculatedAt);
    for (const field of fields) {
      if (JSON.stringify(checked[field]) !== JSON.stringify(result[field])) throw new Error('unverified vacancy fit result');
    }
    return checked;
  }
}
