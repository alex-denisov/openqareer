import { minimizeModelText } from '../providers/modelInputPrivacy';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';
import { DatabaseSync } from 'node:sqlite';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { SqliteVacancyRequirementsStore } from '../data/sqliteVacancyRequirementsStore';
import { SqliteVacancyFitStore } from '../data/sqliteVacancyFitStore';
import { SealedText } from '../data/sealedText';
import { extractVacancyRequirementsWithFallback, vacancyDescriptionHash } from './vacancyRequirements';
import { assessVacancyFit, type VacancyFitInput } from './vacancyFit';
import { createVacancyFitAssessor } from './vacancyFitAssessor';
import type { BulkLlmClient } from '../providers/bulkLlmClient';
import { measuredBulkClient } from './measuredBulkClient';
import { emptyVacancyMechanicsStats, type VacancyMechanicsStats } from './vacancyMechanicsStats';

/** Requirements a fit job is waiting for jump ahead of title-strategy work (priority 1). */
const FIT_DEPENDENCY_PRIORITY = 2;

/** The HTTP process enqueues/reads only. runNext is called by a separate worker. */
export class VacancyMechanicsRuntime {
  readonly database: DatabaseSync;
  readonly requirements: SqliteVacancyRequirementsStore;
  readonly fit: SqliteVacancyFitStore;
  private stats: VacancyMechanicsStats = emptyVacancyMechanicsStats();
  constructor(databasePath: string, encryptionKey: Buffer, private readonly validateCurrentProfile?: (input: VacancyFitInput) => boolean) {
    this.database = new DatabaseSync(databasePath);
    applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
    this.requirements = new SqliteVacancyRequirementsStore(this.database);
    this.fit = new SqliteVacancyFitStore(this.database, new SealedText(encryptionKey));
  }
  view(input: VacancyFitInput): VacancyFitView {
    const extracted = this.requirements.getLatest(input.vacancyId, vacancyDescriptionHash(input.description));
    const resolved = { ...input, requirements: extracted?.requirements ?? [] };
    const result = this.fit.getCache(resolved);
    const queued = this.fit.getJobState(input) ?? this.fit.getJobState(resolved);
    const state = !input.description.trim() ? 'no_description'
      : extracted?.status === 'no_requirements' ? 'no_requirements' : result ? 'ready'
        : queued === 'failed' ? 'failed' : queued === 'retrying' ? 'retrying'
          : queued === 'pending' || queued === 'leased' ? 'processing' : 'not_requested';
    return { state, requirements: resolved.requirements, ...(result ? { result } : {}) };
  }
  cachedVacancyIds(candidateId: string): Set<string> { return this.fit.cachedVacancyIds(candidateId); }
  enqueue(input: VacancyFitInput) {
    const requirementInput = { vacancyId: input.vacancyId, description: input.description };
    // This method is reached only by an explicit authenticated POST, never by the worker retry loop.
    this.requirements.retryFailed(requirementInput);
    this.requirements.enqueue(requirementInput, { titleStrategyPriority: 1 });
    this.fit.retryFailed(input);
    return this.fit.enqueue(input);
  }
  /** Counters since the previous call: the worker writes one journal line per batch. */
  takeStats(): VacancyMechanicsStats {
    const taken = this.stats;
    this.stats = emptyVacancyMechanicsStats();
    return taken;
  }
  deleteCandidate(candidateId: string) { this.fit.deleteCandidate(candidateId); }
  close() { this.database.close(); }

  async runNext(rawClient: BulkLlmClient | null, workerId = 'vacancy-mechanics'): Promise<boolean> {
    const client = rawClient ? measuredBulkClient(rawClient, () => this.stats) : null;
    const extracted = await this.requirements.runNext(workerId, async (input) => {
      const result = await extractVacancyRequirementsWithFallback(input,
        client ? { extract: async ({ description, instructions }) => (await client.complete({
          runId: workerId, task: 'vacancy-requirements', dataClass: 'public', prefix: instructions,
          input: minimizeModelText(description), maxTokens: 2048,
        })).content } : undefined);
      if (result.fallbackStatus === 'unavailable') this.stats.requirementsUnavailable += 1;
      else if (result.fallbackStatus === 'invalid') this.stats.requirementsInvalid += 1;
      return result;
    });
    if (extracted) this.stats.requirementsDone += 1;
    const job = this.fit.claim({ leaseMs: 300000 });
    if (!job) return Boolean(extracted);
    this.stats.claimed += 1;
    try {
      const requirements = this.requirements.getLatest(job.input.vacancyId, vacancyDescriptionHash(job.input.description));
      if (!requirements) {
        const dependency = this.requirements.enqueue({ vacancyId: job.input.vacancyId, description: job.input.description }, { titleStrategyPriority: FIT_DEPENDENCY_PRIORITY });
        if (dependency.state === 'failed') this.recordFailure(this.fit.fail(job, { reason: 'requirements_failed' }), 'requirements_failed');
        else if (this.fit.defer(job) === 'failed') this.recordFailure(true, 'requirements_wait_timeout');
        else this.stats.deferred += 1;
        return Boolean(extracted);
      }
      const resolved = { ...job.input, requirements: requirements.requirements };
      let staleProfile = false;
      let assessmentReturned = false;
      const base = client ? createVacancyFitAssessor(client, workerId) : undefined;
      const assessor = base ? { assess: async (input: Parameters<typeof base.assess>[0]) => {
        if (!this.validateCurrentProfile?.(resolved)) { staleProfile = true; throw new Error('profile_changed'); }
        const assessments = await base.assess(input);
        assessmentReturned = true;
        return assessments;
      } } : undefined;
      const result = await assessVacancyFit(resolved, assessor);
      if (client && result.reason === 'assessment_unavailable' && !assessmentReturned) {
        this.settleFailure(job, staleProfile ? 'profile_changed' : 'assessment_model_unavailable', !staleProfile && job.attempts < 3);
      } else if (this.fit.complete(job, result, undefined, resolved)) this.stats.completed += 1;
    } catch (error) {
      this.settleFailure(job, error instanceof Error && /^[a-z0-9_:-]{1,80}$/iu.test(error.message) ? error.message : 'assessment_failed', job.attempts < 3);
    }
    return true;
  }

  private settleFailure(job: Parameters<SqliteVacancyFitStore['fail']>[0], reason: string, retry: boolean): void {
    const settled = this.fit.fail(job, { retry, reason });
    if (retry && settled) { this.stats.retried += 1; this.stats.lastError = reason; } else this.recordFailure(settled, reason);
  }

  private recordFailure(settled: boolean, reason: string): void {
    if (!settled) return;
    this.stats.failed += 1;
    this.stats.lastError = reason;
  }
}
