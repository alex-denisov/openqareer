import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  vacancyRequirementsCacheKey,
  vacancyDescriptionHash,
  VACANCY_REQUIREMENTS_EXTRACTOR_VERSION,
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
  }

  get(input: VacancyRequirementsInput): VacancyRequirementsResult | null {
    const row = this.db.prepare('SELECT result_json FROM vacancy_requirements_cache WHERE cache_key=?')
      .get(vacancyRequirementsCacheKey(input)) as { result_json: string } | undefined;
    if (row) return JSON.parse(row.result_json) as VacancyRequirementsResult;
    const cluster = input.clusterId ? this.getByCluster(input.clusterId, vacancyDescriptionHash(input.description), input.extractorVersion ?? VACANCY_REQUIREMENTS_EXTRACTOR_VERSION) : null;
    return cluster ? { ...cluster, vacancyId: input.vacancyId } : null;
  }

  getLatest(vacancyId: string, descriptionHash?: string): VacancyRequirementsResult | null {
    const row = this.db.prepare(`SELECT result_json FROM vacancy_requirements_cache
      WHERE vacancy_id=? ${descriptionHash ? 'AND description_hash=?' : ''} ORDER BY updated_at DESC,rowid DESC LIMIT 1`)
      .get(...(descriptionHash ? [vacancyId, descriptionHash] : [vacancyId])) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) as VacancyRequirementsResult : null;
  }

  getByCluster(clusterId: string, descriptionHash: string, extractorVersion: string): VacancyRequirementsResult | null {
    const row = this.db.prepare(`SELECT result_json FROM vacancy_requirements_cache
      WHERE cluster_id=? AND description_hash=? AND extractor_version=? ORDER BY updated_at DESC LIMIT 1`)
      .get(clusterId, descriptionHash, extractorVersion) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) as VacancyRequirementsResult : null;
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

  claim(workerId: string, now = Date.now(), leaseMs = 60000): VacancyRequirementsJob | null {
    if (!workerId.trim() || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('invalid_worker_lease');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='failed',lease_token=NULL
        WHERE status='leased' AND lease_until<=? AND attempts>=3`).run(now);
      const row = this.db.prepare(`SELECT id,input_json,attempts FROM vacancy_requirements_jobs
        WHERE attempts<3 AND ((status='queued' AND available_at<=?) OR (status='leased' AND lease_until<=?))
        ORDER BY priority DESC,fresh_at DESC,created_at,id LIMIT 1`).get(now, now) as JobRow | undefined;
      if (!row) { this.db.exec('COMMIT'); return null; }
      const token = `${workerId}:${randomUUID()}`;
      this.db.prepare(`UPDATE vacancy_requirements_jobs SET status='leased',attempts=attempts+1,
        lease_token=?,lease_until=?,updated_at=? WHERE id=?`).run(token, now + leaseMs, now, row.id);
      this.db.exec('COMMIT');
      return { id: row.id, input: JSON.parse(row.input_json) as VacancyRequirementsInput, leaseToken: token, leaseUntil: now + leaseMs, attempts: row.attempts + 1 };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  complete(job: VacancyRequirementsJob, result: VacancyRequirementsResult, now = Date.now()): void {
    if (result.fallbackStatus === 'unavailable' || result.fallbackStatus === 'invalid') throw new Error(`requirements_model_${result.fallbackStatus}`);
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
      lease_until=NULL,last_error=?,updated_at=? WHERE id=? AND lease_token=?`)
      .run(job.attempts >= 3 ? 'failed' : 'queued', now + 1000 * 2 ** job.attempts, safeCode, now, job.id, job.leaseToken);
  }

  private assertLease(job: VacancyRequirementsJob, now: number): void {
    const row = this.db.prepare(`SELECT id FROM vacancy_requirements_jobs WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?`)
      .get(job.id, job.leaseToken, now);
    if (!row) throw new Error('requirements_job_lease_lost');
  }

  async runNext(workerId: string, extract: (input: VacancyRequirementsInput) => Promise<VacancyRequirementsResult>, now = Date.now()): Promise<VacancyRequirementsResult | null> {
    const startedAt = Date.now();
    const job = this.claim(workerId, now);
    if (!job) return null;
    try {
      const result = this.get(job.input) ?? await extract(job.input);
      // Actual elapsed time is material: never let an expired worker write over a new lease.
      this.complete(job, result, now + (Date.now() - startedAt));
      return result;
    } catch (error) {
      try { this.fail(job, error instanceof Error ? error.message : 'extraction_failed', now + (Date.now() - startedAt)); } catch { /* Another worker owns expired work. */ }
      return null;
    }
  }
}
