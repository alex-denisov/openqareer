import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { VacancyFitResult } from '../../shared/vacancyFit';
import { evaluateVacancyFit, vacancyFitFingerprint, type VacancyFitInput } from '../domain/vacancyFit';
import { SealedText } from './sealedText';

export interface VacancyFitJob {
  readonly key: string;
  readonly leaseToken: string;
  readonly leaseUntil: string;
  readonly attempts: number;
  readonly input: VacancyFitInput;
}
interface JobRow { cache_key: string; input_cipher: string; lease_token: string; lease_until: string; attempts: number }

/** Candidate facts/results are encrypted; all tenant correlation indexes use keyed HMAC. */
export class SqliteVacancyFitStore {
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
    CREATE INDEX IF NOT EXISTS vacancy_fit_queue_candidate ON vacancy_fit_queue(candidate_key);`);
  }

  private candidateKey(candidateId: string): string {
    return this.sealedText.indexToken('vacancy-fit-candidate', candidateId);
  }
  cacheKey(input: VacancyFitInput): string {
    const fingerprint = vacancyFitFingerprint(input);
    return this.sealedText.indexToken(`vacancy-fit:${input.candidateId}`, JSON.stringify(fingerprint));
  }

  getJobState(input: VacancyFitInput): string | undefined {
    const row = this.database.prepare('SELECT status FROM vacancy_fit_queue WHERE cache_key=? AND candidate_key=?')
      .get(this.cacheKey(input), this.candidateKey(input.candidateId)) as { status: string } | undefined;
    return row?.status;
  }

  getCache(input: VacancyFitInput): VacancyFitResult | undefined {
    const key = this.cacheKey(input);
    const row = this.database.prepare('SELECT result_cipher FROM vacancy_fit_cache WHERE cache_key = ? AND candidate_key = ?').get(key, this.candidateKey(input.candidateId)) as { result_cipher: string } | undefined;
    if (!row) return undefined;
    try {
      const result = JSON.parse(this.sealedText.open(row.result_cipher, key)) as VacancyFitResult;
      this.validateResult(input, result);
      return result;
    } catch { return undefined; }
  }

  /**
   * Вакансии, по которым у кандидата есть сохранённый результат, — одним
   * чтением. Сортировка пула считает точный разбор только для них, а не для
   * тысяч вакансий без результата. Свежесть результата проверяет getCache.
   */
  cachedVacancyIds(candidateId: string): Set<string> {
    const rows = this.database.prepare('SELECT cache_key, result_cipher FROM vacancy_fit_cache WHERE candidate_key = ?')
      .all(this.candidateKey(candidateId)) as { cache_key: string; result_cipher: string }[];
    const ids = new Set<string>();
    for (const row of rows) {
      try {
        const result = JSON.parse(this.sealedText.open(row.result_cipher, row.cache_key)) as VacancyFitResult;
        if (result.candidateId === candidateId) ids.add(result.vacancyId);
      } catch { /* повреждённая строка не даёт вакансии результата */ }
    }
    return ids;
  }

  putCache(input: VacancyFitInput, result: VacancyFitResult, now = new Date().toISOString()): void {
    this.validateResult(input, result);
    const key = this.cacheKey(input);
    this.database.prepare(`INSERT INTO vacancy_fit_cache(cache_key,candidate_key,result_cipher,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET result_cipher=excluded.result_cipher,updated_at=excluded.updated_at`).run(key, this.candidateKey(input.candidateId), this.sealedText.seal(JSON.stringify(result), key), now);
  }

  /** Input hash changes naturally enqueue a new job; identical work is idempotent across processes. */
  enqueue(input: VacancyFitInput, now = new Date().toISOString()): { key: string; status: string } {
    const key = this.cacheKey(input);
    this.database.prepare(`INSERT OR IGNORE INTO vacancy_fit_queue(cache_key,candidate_key,input_cipher,status,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?)`).run(key, this.candidateKey(input.candidateId), this.sealedText.seal(JSON.stringify(input), key), now, now);
    const row = this.database.prepare('SELECT status FROM vacancy_fit_queue WHERE cache_key=?').get(key) as { status: string };
    return { key, status: row.status };
  }

  retryFailed(input: VacancyFitInput, now = new Date().toISOString()): void {
    const key = this.cacheKey(input);
    this.database.prepare(`UPDATE vacancy_fit_queue SET status='pending',input_cipher=?,attempts=0,
      lease_token=NULL,lease_until=NULL,updated_at=? WHERE cache_key=? AND candidate_key=? AND status='failed'`)
      .run(this.sealedText.seal(JSON.stringify(input), key), now, key, this.candidateKey(input.candidateId));
  }

  /** One atomic update makes competing workers safe; expired work is retried with a new fencing token. */
  claim(options: { now?: string; leaseMs?: number } = {}): VacancyFitJob | undefined {
    const now = options.now ?? new Date().toISOString();
    const leaseMs = options.leaseMs ?? 60_000;
    if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('invalid vacancy fit lease');
    const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString();
    const token = randomUUID();
    const row = this.database.prepare(`UPDATE vacancy_fit_queue SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
      WHERE cache_key=(SELECT cache_key FROM vacancy_fit_queue WHERE (status='pending' AND (lease_until IS NULL OR lease_until<=?)) OR (status='leased' AND lease_until<=?) ORDER BY created_at,cache_key LIMIT 1)
      RETURNING cache_key,input_cipher,lease_token,lease_until,attempts`).get(token, leaseUntil, now, now, now) as JobRow | undefined;
    if (!row) return undefined;
    try {
      const input = JSON.parse(this.sealedText.open(row.input_cipher, row.cache_key)) as VacancyFitInput;
      if (this.cacheKey(input) !== row.cache_key) throw new Error('invalid vacancy fit job');
      return { key: row.cache_key, leaseToken: row.lease_token, leaseUntil: row.lease_until, attempts: row.attempts, input };
    } catch {
      this.database.prepare("UPDATE vacancy_fit_queue SET status='failed',input_cipher='',lease_token=NULL,lease_until=NULL WHERE cache_key=? AND lease_token=?").run(row.cache_key, token);
      return undefined;
    }
  }

  /** A stale worker cannot publish a result after another worker has reclaimed the lease. */
  complete(job: VacancyFitJob, result: VacancyFitResult, now = new Date().toISOString(), resolvedInput: VacancyFitInput = job.input): boolean {
    this.validateResult(resolvedInput, result);
    if (resolvedInput.candidateId !== job.input.candidateId || resolvedInput.vacancyId !== job.input.vacancyId || resolvedInput.description !== job.input.description || JSON.stringify(resolvedInput.facts) !== JSON.stringify(job.input.facts)) throw new Error('vacancy fit resolved input scope mismatch');
    if (this.cacheKey(job.input) !== job.key) return false;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const update = this.database.prepare(`UPDATE vacancy_fit_queue SET status='completed',input_cipher='',lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE cache_key=? AND status='leased' AND lease_token=? AND lease_until>?`).run(now, job.key, job.leaseToken, now);
      if (Number(update.changes) !== 1) { this.database.exec('COMMIT'); return false; }
      this.putCache(resolvedInput, result, now);
      this.database.exec('COMMIT');
      return true;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  defer(job: VacancyFitJob, now = new Date().toISOString(), delayMs = 5000): boolean {
    const available = new Date(Date.parse(now) + delayMs).toISOString();
    const update = this.database.prepare(`UPDATE vacancy_fit_queue
      SET status='pending',lease_token=NULL,lease_until=?,attempts=MAX(0,attempts-1),updated_at=?
      WHERE cache_key=? AND status='leased' AND lease_token=? AND lease_until>?`)
      .run(available, now, job.key, job.leaseToken, now);
    return Number(update.changes) === 1;
  }

  fail(job: VacancyFitJob, options: { retry?: boolean; now?: string } = {}): boolean {
    const now = options.now ?? new Date().toISOString();
    const update = this.database.prepare(`UPDATE vacancy_fit_queue SET status=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE cache_key=? AND status='leased' AND lease_token=? AND lease_until>?`).run(options.retry ? 'pending' : 'failed', now, job.key, job.leaseToken, now);
    return Number(update.changes) === 1;
  }

  deleteCandidate(candidateId: string): void {
    const key = this.candidateKey(candidateId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM vacancy_fit_cache WHERE candidate_key=?').run(key);
      this.database.prepare('DELETE FROM vacancy_fit_queue WHERE candidate_key=?').run(key);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  private validateResult(input: VacancyFitInput, result: VacancyFitResult): void {
    if (result.candidateId !== input.candidateId || result.vacancyId !== input.vacancyId || result.algorithmVersion !== vacancyFitFingerprint(input).algorithmVersion) throw new Error('vacancy fit result scope mismatch');
    if (!Number.isFinite(Date.parse(result.calculatedAt))) throw new Error('invalid vacancy fit result date');
    const checked = evaluateVacancyFit({ ...input, assessments: result.assessments }, result.calculatedAt);
    for (const field of ['gates', 'assessments', 'status', 'dataState', 'coveragePercent', 'coverage', 'requiredCoverage', 'reason'] as const) {
      if (JSON.stringify(checked[field]) !== JSON.stringify(result[field])) throw new Error('unverified vacancy fit result');
    }
  }
}
