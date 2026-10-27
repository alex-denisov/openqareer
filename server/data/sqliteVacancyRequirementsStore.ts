import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { addLateColumns } from './sqliteLateColumn';
import {
  vacancyRequirementsCacheKey,
  VacancyRequirementsPausedError,
  vacancyDescriptionHash,
  VACANCY_REQUIREMENTS_EXTRACTOR_VERSION,
  LEGACY_REQUIREMENTS_EXTRACTOR_VERSIONS,
  type VacancyRequirementsInput,
  type VacancyRequirementsResult,
} from '../domain/vacancyRequirements';

export interface VacancyRequirementsJob {
  readonly id: string;
  readonly input: VacancyRequirementsInput;
  readonly leaseToken: string;
  readonly leaseUntil: number;
  readonly attempts: number;
}
interface JobRow { id: string; input_json: string; lease_token: string; lease_until: number; attempts: number }

/** Public vacancy data only. Constructed by the background worker's own DB connection. */
/** Bumped when a parser change makes earlier model failures worth one more try (B522: 2; B562-r quotes: 4). */
export const MECHANICS_REQUEUE_REVISION = 4;
/** Claims per job: `claim` skips rows at this count and `fail` settles them as failed. */
const MAX_ATTEMPTS = 3;
/** Below title strategy (0.5–1), shown pages (1.5) and fit dependencies (2): the background tail (B510). */
export const LABEL_UPGRADE_PRIORITY = 0.1;
/** A requeue keeps label upgrades (0.1) and title strategy below shown pages, and never lifts a job above them (B510-r). */
const REQUEUE_PRIORITY = 1.5;

export class SqliteVacancyRequirementsStore {
  constructor(private readonly db: DatabaseSync) { this.ensureSchema(); }

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vacancy_requirements_cache (
        cache_key TEXT PRIMARY KEY, vacancy_id TEXT NOT NULL, cluster_id TEXT,
        description_hash TEXT NOT NULL, extractor_version TEXT NOT NULL,
        result_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS vacancy_requirements_latest ON vacancy_requirements_cache(vacancy_id,updated_at DESC);
      CREATE INDEX IF NOT EXISTS vacancy_requirements_cluster ON vacancy_requirements_cache(cluster_id,description_hash);
      CREATE TABLE IF NOT EXISTS vacancy_requirements_jobs (
        id TEXT PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE, input_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued', priority REAL NOT NULL DEFAULT 0,
        fresh_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
        last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS vacancy_requirements_ready ON vacancy_requirements_jobs(status,available_at,priority DESC,fresh_at DESC);
    `);
    addLateColumns(this.db, 'vacancy_requirements_jobs', [['requeue_revision', 'INTEGER']]);
  }

  get(input: VacancyRequirementsInput): VacancyRequirementsResult | null {
    const row = this.db.prepare('SELECT result_json FROM vacancy_requirements_cache WHERE cache_key=?')
      .get(vacancyRequirementsCacheKey(input)) as { result_json: string } | undefined;
    if (row) return JSON.parse(row.result_json) as VacancyRequirementsResult;
    const cluster = input.clusterId ? this.getByCluster(input.clusterId, vacancyDescriptionHash(input.description), input.extractorVersion ?? VACANCY_REQUIREMENTS_EXTRACTOR_VERSION) : null;
    return cluster ? { ...cluster, vacancyId: input.vacancyId } : null;
  }

  getLatest(vacancyId: string, descriptionHash?: string, extractorVersion = VACANCY_REQUIREMENTS_EXTRACTOR_VERSION): VacancyRequirementsResult | null {
    const row = this.db.prepare(`SELECT result_json FROM vacancy_requirements_cache
      WHERE vacancy_id=? AND extractor_version=? ${descriptionHash ? 'AND description_hash=?' : ''} ORDER BY updated_at DESC,rowid DESC LIMIT 1`)
      .get(...(descriptionHash ? [vacancyId, extractorVersion, descriptionHash] : [vacancyId, extractorVersion])) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) as VacancyRequirementsResult : null;
  }

  /** Current labels first, then a cache from before them (B510): the upgrade is gradual. */
  getLatestOrLegacy(vacancyId: string, descriptionHash?: string): VacancyRequirementsResult | null {
    for (const version of [VACANCY_REQUIREMENTS_EXTRACTOR_VERSION, ...LEGACY_REQUIREMENTS_EXTRACTOR_VERSIONS]) {
      const result = this.getLatest(vacancyId, descriptionHash, version);
      if (result) return result;
    }
    return null;
  }

  /**
   * B510: queue the current extractor for every description that only has a legacy cache, at the
   * lowest priority, so shown pages and fit dependencies go first. Idempotent; the B522 budget
   * still caps the daily spend.
   */
  enqueueLabelUpgrades(now = Date.now()): number {
    const rows = this.db.prepare(`SELECT input_json FROM vacancy_requirements_jobs WHERE status='completed'`).all() as Array<{ input_json: string }>;
    let queued = 0;
    for (const row of rows) {
      const input = JSON.parse(row.input_json) as VacancyRequirementsInput;
      if (input.extractorVersion && input.extractorVersion === VACANCY_REQUIREMENTS_EXTRACTOR_VERSION) continue;
      const current = { vacancyId: input.vacancyId, ...(input.clusterId ? { clusterId: input.clusterId } : {}), description: input.description };
      const key = vacancyRequirementsCacheKey(current);
      if (this.db.prepare('SELECT 1 FROM vacancy_requirements_jobs WHERE cache_key=?').get(key)) continue;
      if (this.db.prepare('SELECT 1 FROM vacancy_requirements_cache WHERE cache_key=?').get(key)) continue;
      this.enqueue(current, { titleStrategyPriority: LABEL_UPGRADE_PRIORITY, now });
      queued += 1;
    }
    return queued;
  }

  getByCluster(clusterId: string, descriptionHash: string, extractorVersion: string): VacancyRequirementsResult | null {
    const row = this.db.prepare(`SELECT result_json FROM vacancy_requirements_cache
      WHERE cluster_id=? AND description_hash=? AND extractor_version=? ORDER BY updated_at DESC LIMIT 1`)
      .get(clusterId, descriptionHash, extractorVersion) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) as VacancyRequirementsResult : null;
  }

  retryFailed(input: VacancyRequirementsInput, now = Date.now()): void {
    this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='queued',attempts=0,available_at=0,
      lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE cache_key=? AND status='failed'`)
      .run(now, vacancyRequirementsCacheKey(input));
  }

  enqueue(input: VacancyRequirementsInput, options: { titleStrategyPriority?: number; freshAt?: number; now?: number } = {}): { state: 'cached' | 'queued' | 'failed'; jobId?: string } {
    const cached = this.get(input);
    if (cached) {
      this.db.prepare(`INSERT OR IGNORE INTO vacancy_requirements_cache
        (cache_key,vacancy_id,cluster_id,description_hash,extractor_version,result_json,updated_at) VALUES(?,?,?,?,?,?,?)`)
        .run(vacancyRequirementsCacheKey(input), input.vacancyId, input.clusterId ?? null, cached.descriptionHash, cached.extractorVersion, JSON.stringify(cached), options.now ?? Date.now());
      return { state: 'cached' };
    }
    const now = options.now ?? Date.now();
    const priority = Number.isFinite(options.titleStrategyPriority) ? options.titleStrategyPriority! : 0;
    const fresh = Number.isFinite(options.freshAt) ? options.freshAt! : 0;
    const key = vacancyRequirementsCacheKey(input);
    this.db.prepare(`INSERT INTO vacancy_requirements_jobs
      (id,cache_key,input_json,priority,fresh_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET priority=MAX(priority,excluded.priority),fresh_at=MAX(fresh_at,excluded.fresh_at)`)
      .run(randomUUID(), key, JSON.stringify(input), priority, fresh, now, now);
    const row = this.db.prepare('SELECT id,status FROM vacancy_requirements_jobs WHERE cache_key=?').get(key) as { id: string; status: string };
    return { state: row.status === 'failed' ? 'failed' : 'queued', jobId: row.id };
  }

  /** `minPriority` limits the claim to work a candidate waits for (shown page, fit dependency). */
  claim(workerId: string, now = Date.now(), leaseMs = 60000, minPriority = Number.NEGATIVE_INFINITY): VacancyRequirementsJob | null {
    if (!workerId.trim() || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('invalid_worker_lease');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='failed',lease_token=NULL
        WHERE status='leased' AND lease_until<=? AND attempts>=3`).run(now);
      const row = this.db.prepare(`SELECT id,input_json,attempts FROM vacancy_requirements_jobs
        WHERE attempts<3 AND priority>=? AND ((status='queued' AND available_at<=?) OR (status='leased' AND lease_until<=?))
        ORDER BY priority DESC,fresh_at DESC,created_at,id LIMIT 1`).get(minPriority, now, now) as JobRow | undefined;
      if (!row) { this.db.exec('COMMIT'); return null; }
      const token = `${workerId}:${randomUUID()}`;
      this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='leased',attempts=attempts+1,
        lease_token=?,lease_until=?,updated_at=? WHERE id=?`).run(token, now + leaseMs, now, row.id);
      this.db.exec('COMMIT');
      return { id: row.id, input: JSON.parse(row.input_json) as VacancyRequirementsInput, leaseToken: token, leaseUntil: now + leaseMs, attempts: row.attempts + 1 };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  /**
   * An invalid model answer is retried; after the last attempt the rule requirements it carries are
   * the result, so the vacancy is not `failed` while its text has requirements (B562-r). An outage
   * (`unavailable`) never becomes a final answer.
   */
  complete(job: VacancyRequirementsJob, result: VacancyRequirementsResult, now = Date.now()): void {
    const finalInvalid = result.fallbackStatus === 'invalid' && job.attempts >= MAX_ATTEMPTS;
    if ((result.fallbackStatus === 'unavailable' || result.fallbackStatus === 'invalid') && !finalInvalid) throw new Error(`requirements_model_${result.fallbackStatus}`);
    const expected = vacancyRequirementsCacheKey(job.input);
    const actual = JSON.stringify([result.vacancyId, result.clusterId ?? '', result.descriptionHash, result.extractorVersion]);
    if (expected !== actual) throw new Error('requirements_result_identity_mismatch');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertLease(job, now);
      this.db.prepare(`INSERT INTO vacancy_requirements_cache
        (cache_key,vacancy_id,cluster_id,description_hash,extractor_version,result_json,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET result_json=excluded.result_json,updated_at=excluded.updated_at`)
        .run(expected, result.vacancyId, result.clusterId ?? null, result.descriptionHash, result.extractorVersion, JSON.stringify(result), now);
      this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='completed',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?`).run(now, job.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  fail(job: VacancyRequirementsJob, code: string, now = Date.now()): void {
    this.assertLease(job, now);
    // Error classes only: provider bodies and vacancy text do not enter the job journal.
    const safeCode = /^[a-z0-9_:-]{1,80}$/iu.test(code) ? code : 'extraction_failed';
    this.db.prepare(`UPDATE vacancy_requirements_jobs SET status=?,available_at=?,lease_token=NULL,
      lease_until=NULL,last_error=?,requeue_revision=?,updated_at=? WHERE id=? AND lease_token=?`)
      .run(job.attempts >= 3 ? 'failed' : 'queued', now + 1000 * 2 ** job.attempts, safeCode, MECHANICS_REQUEUE_REVISION, now, job.id, job.leaseToken);
  }

  /** A spend-budget refusal returns the claim: the attempt does not count and the job waits until `until` (B556). */
  pause(job: VacancyRequirementsJob, until: number, now = Date.now()): void {
    this.assertLease(job, now);
    this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='queued',attempts=MAX(attempts-1,0),available_at=?,
      lease_token=NULL,lease_until=NULL,last_error='requirements_budget_paused',updated_at=? WHERE id=? AND lease_token=?`)
      .run(until, now, job.id, job.leaseToken);
  }

  /**
   * One requeue of model failures after a parser upgrade: rows that failed under an older
   * revision go back once, at most at the shown-page priority (1.5). Later failures carry the current
   * revision and are never requeued by this again.
   */
  requeueModelFailures(revision = MECHANICS_REQUEUE_REVISION, now = Date.now()): number {
    const update = this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='queued',attempts=0,available_at=0,
      lease_token=NULL,lease_until=NULL,priority=MIN(priority,?),requeue_revision=?,updated_at=?
      WHERE status='failed' AND last_error IN ('requirements_model_invalid','requirements_model_unavailable')
        AND COALESCE(requeue_revision,1)<?`).run(REQUEUE_PRIORITY, revision, now, revision);
    return Number(update.changes);
  }

  private assertLease(job: VacancyRequirementsJob, now: number): void {
    const row = this.db.prepare(`SELECT id FROM vacancy_requirements_jobs WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`)
      .get(job.id, job.leaseToken, now);
    if (!row) throw new Error('requirements_job_lease_lost');
  }

  async runNext(workerId: string, extract: (input: VacancyRequirementsInput) => Promise<VacancyRequirementsResult>, now = Date.now(), minPriority = Number.NEGATIVE_INFINITY): Promise<VacancyRequirementsResult | null> {
    const startedAt = Date.now();
    // Provider work is bounded by three 60-second attempts plus two 5-second pauses.
    // Keep the lease beyond that complete retry window, not just one request.
    const job = this.claim(workerId, now, 300000, minPriority);
    if (!job) return null;
    try {
      const result = this.get(job.input) ?? await extract(job.input);
      // Actual elapsed time is material: never let an expired worker write over a new lease.
      this.complete(job, result, now + (Date.now() - startedAt));
      return result;
    } catch (error) {
      try {
        if (error instanceof VacancyRequirementsPausedError) this.pause(job, error.until, now + (Date.now() - startedAt));
        else this.fail(job, error instanceof Error ? error.message : 'extraction_failed', now + (Date.now() - startedAt));
      } catch { /* Another worker owns expired work. */ }
      return null;
    }
  }
}
