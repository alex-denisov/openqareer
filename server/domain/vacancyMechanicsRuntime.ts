import { minimizeModelText } from '../providers/modelInputPrivacy';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';
import { DatabaseSync } from 'node:sqlite';
import type { VacancyFitFailure, VacancyFitView } from '../../shared/vacancyFit';
import { SqliteVacancyRequirementsStore } from '../data/sqliteVacancyRequirementsStore';
import { SqliteVacancyFitStore, type FitEnqueueOptions } from '../data/sqliteVacancyFitStore';
import { SealedText } from '../data/sealedText';
import { extractVacancyRequirements, extractVacancyRequirementsWithFallback, vacancyDescriptionHash, VacancyRequirementsPausedError, VACANCY_REQUIREMENTS_EXTRACTOR_VERSION } from './vacancyRequirements';
import { labelVacancyRequirement } from './vacancyRequirementLabel';
import { assessVacancyFit, type VacancyFitInput } from './vacancyFit';
import { createVacancyFitAssessor, type VacancyFitBulkClient } from './vacancyFitAssessor';
import { BULK_BUDGET_EXCEEDED, type BulkLlmClient } from '../providers/bulkLlmClient';
import { measuredBulkClient, type BulkCompletion } from './measuredBulkClient';
import { emptyVacancyMechanicsStats, type VacancyMechanicsStats } from './vacancyMechanicsStats';

/** Requirements a fit job is waiting for jump ahead of title-strategy work (priority 1). */
const FIT_DEPENDENCY_PRIORITY = 2;
/** A vacancy a candidate is looking at gets model labels before the background tail (B510). */
export const SHOWN_PAGE_PRIORITY = 1.5;
/** Below a fit the candidate asked for (1), above the maintenance backlog (0). */
const BACKGROUND_REQUIREMENTS_PRIORITY = 0.5;

/** Error classes of a failed fit job as the row names them; anything else is a plain «не завершился». */
const FIT_FAILURES: Readonly<Record<string, VacancyFitFailure>> = {
  assessment_model_unavailable: 'model_unavailable',
  assessment_model_invalid: 'model_invalid',
  requirements_failed: 'requirements',
  requirements_wait_timeout: 'requirements',
  profile_changed: 'profile_changed',
};
interface AssessmentOutcome {
  staleProfile: boolean;
  returned: boolean;
  invalid: boolean;
}
function assessmentFailure(outcome: AssessmentOutcome): string {
  return outcome.staleProfile
    ? 'profile_changed'
    : outcome.invalid
      ? 'assessment_model_invalid'
      : 'assessment_model_unavailable';
}
function fitFailure(lastError: string | null | undefined): VacancyFitFailure {
  return (lastError && FIT_FAILURES[lastError]) || 'other';
}

/** The HTTP process enqueues/reads only. runNext is called by a separate worker. */
/**
 * The worker's budget run is one UTC day of this worker: RUN_USD is its explicit daily cap, while
 * DAY_USD caps the whole bulk channel per day (worker plus server-side fact extraction). A run per
 * process launch would stop a worker that never restarts for good once RUN_USD was spent.
 */
export function workerDayRunId(workerId: string, now = new Date()): string {
  return `${workerId}:${now.toISOString().slice(0, 10)}`;
}

export class VacancyMechanicsRuntime {
  readonly database: DatabaseSync;
  readonly requirements: SqliteVacancyRequirementsStore;
  readonly fit: SqliteVacancyFitStore;
  private stats: VacancyMechanicsStats = emptyVacancyMechanicsStats();
  /** Until the next UTC day after a budget refusal: no job is claimed for a call that would be refused (B556). */
  private budgetPausedUntil = 0;
  constructor(databasePath: string, encryptionKey: Buffer, private readonly validateCurrentProfile?: (input: VacancyFitInput) => boolean) {
    this.database = new DatabaseSync(databasePath);
    applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
    this.requirements = new SqliteVacancyRequirementsStore(this.database);
    this.fit = new SqliteVacancyFitStore(this.database, new SealedText(encryptionKey));
  }
  view(input: VacancyFitInput): VacancyFitView {
    const extracted = this.requirements.getLatestOrLegacy(input.vacancyId, vacancyDescriptionHash(input.description));
    // B510: a shown vacancy without model labels jumps ahead of the background upgrade.
    if (input.description.trim() && extracted?.extractorVersion !== VACANCY_REQUIREMENTS_EXTRACTOR_VERSION) {
      this.requirements.enqueue({ vacancyId: input.vacancyId, description: input.description }, { titleStrategyPriority: SHOWN_PAGE_PRIORITY });
    }
    // Until the worker answers, the rules give the chips; the state below stays honest.
    const shown = extracted ?? extractVacancyRequirements({ vacancyId: input.vacancyId, description: input.description });
    const resolved = { ...input, requirements: extracted?.requirements ?? [] };
    const current = this.fit.getCache(resolved);
    const job = this.fit.getJobStatus(input) ?? this.fit.getJobStatus(resolved);
    const queued = job?.state;
    // B562-r: a version bump keeps the known percent on screen until the new result is ready.
    // A failed refresh keeps it too (29.10): «не посчитан» over a known percent broke the order.
    const previous = current ? undefined : this.fit.getPreviousCache(resolved);
    const result = current ?? previous;
    const state = !input.description.trim()
      ? 'no_description'
      : extracted?.status === 'no_requirements'
        ? 'no_requirements'
        : current
          ? 'ready'
          : previous
            ? 'refreshing'
            : queued === 'failed'
              ? 'failed'
              : queued === 'retrying'
                ? 'retrying'
                : queued === 'pending' || queued === 'leased'
                  ? 'processing'
                  : 'not_requested';
    return {
      state,
      requirements: shown.requirements.map(labelVacancyRequirement),
      ...(result ? { result } : {}),
      ...(state === 'failed' ? { failure: fitFailure(job?.lastError) } : {}),
    };
  }
  cachedVacancyIds(candidateId: string): Set<string> { return this.fit.cachedVacancyIds(candidateId); }
  /** `backgroundRank` (B580): the selection sweep queues below every page the candidate looks at. */
  enqueue(input: VacancyFitInput, options: FitEnqueueOptions = {}) {
    const requirementInput = { vacancyId: input.vacancyId, description: input.description };
    // This method is reached only by an explicit authenticated POST, never by the worker retry loop.
    this.requirements.retryFailed(requirementInput);
    this.requirements.enqueue(requirementInput, { titleStrategyPriority: options.backgroundRank === undefined ? 1 : BACKGROUND_REQUIREMENTS_PRIORITY });
    this.fit.retryFailed(input, undefined, options);
    return this.fit.enqueue(input, undefined, options);
  }
  /** Worker start: one requeue of model failures recorded under an older parser revision (B522). */
  requeueAfterParserUpgrade(): { requirements: number; fit: number; labels: number } {
    return { requirements: this.requirements.requeueModelFailures(), fit: this.fit.requeueFailedOnce(), labels: this.requirements.enqueueLabelUpgrades() };
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
    const runId = workerDayRunId(workerId);
    // Work a candidate waits for first: shown-page labels, then a queued fit; the background
    // tail of requirements only when no fit is waiting (before, every fit paid one tail call).
    const shown = await this.extractNextRequirements(client, runId, workerId, SHOWN_PAGE_PRIORITY);
    const job = this.fit.claim({ leaseMs: 300000 });
    if (!job) return shown || (await this.extractNextRequirements(client, runId, workerId));
    const extracted = shown;
    this.stats.claimed += 1;
    try {
      const requirementsInput = { vacancyId: job.input.vacancyId, description: job.input.description };
      let requirements = this.requirements.getLatest(job.input.vacancyId, vacancyDescriptionHash(job.input.description));
      if (!requirements) {
        // B510: extract this vacancy's requirements now instead of deferring. Fresh jobs are claimed
        // first, so on prod every one of 442 queued fits was deferred once (~90 min) before any finished.
        const dependency = this.requirements.enqueue(requirementsInput, { titleStrategyPriority: FIT_DEPENDENCY_PRIORITY, freshAt: Date.now() });
        if (dependency.state === 'queued') {
          await this.extractNextRequirements(client, runId, workerId);
          requirements = this.requirements.getLatest(job.input.vacancyId, vacancyDescriptionHash(job.input.description));
        }
      }
      if (!requirements) {
        const dependency = this.requirements.enqueue(requirementsInput, { titleStrategyPriority: FIT_DEPENDENCY_PRIORITY });
        if (dependency.state === 'failed') this.recordFailure(this.fit.fail(job, { reason: 'requirements_failed' }), 'requirements_failed');
        else if (this.fit.defer(job) === 'failed') this.recordFailure(true, 'requirements_wait_timeout');
        else this.stats.deferred += 1;
        return Boolean(extracted);
      }
      const resolved = { ...job.input, requirements: requirements.requirements };
      const { assessor, outcome } = this.trackedAssessor(client, runId, resolved);
      const result = await assessVacancyFit(resolved, assessor);
      if (client && result.reason === 'assessment_unavailable' && !outcome.returned) {
        this.settleFailure(
          job,
          assessmentFailure(outcome),
          !outcome.staleProfile && job.attempts < 3,
        );
      } else if (this.fit.complete(job, result, undefined, resolved)) this.stats.completed += 1;
    } catch (error) {
      this.settleFailure(job, error instanceof Error && /^[a-z0-9_:-]{1,80}$/iu.test(error.message) ? error.message : 'assessment_failed', job.attempts < 3);
    }
    return true;
  }

  /** The fit assessor with what happened to its call: the failure class names the row (B562-r). */
  private trackedAssessor(
    client: VacancyFitBulkClient | null,
    runId: string,
    resolved: VacancyFitInput,
  ) {
    const outcome: AssessmentOutcome = { staleProfile: false, returned: false, invalid: false };
    const base = client ? createVacancyFitAssessor(client, runId) : undefined;
    const assessor = base
      ? {
          assess: async (input: Parameters<typeof base.assess>[0]) => {
            if (!this.validateCurrentProfile?.(resolved)) {
              outcome.staleProfile = true;
              throw new Error('profile_changed');
            }
            try {
              const assessments = await base.assess(input);
              outcome.returned = true;
              return assessments;
            } catch (error) {
              // The model answered, but not with the assessment shape: not an outage.
              outcome.invalid =
                error instanceof SyntaxError ||
                (error instanceof Error && error.message.startsWith('invalid vacancy fit'));
              throw error;
            }
          },
        }
      : undefined;
    return { assessor, outcome };
  }

  /** One queued requirements job (highest priority first); the counters feed the batch journal line. */
  private async extractNextRequirements(client: BulkCompletion | null, runId: string, workerId: string, minPriority = Number.NEGATIVE_INFINITY): Promise<boolean> {
    if (client && Date.now() < this.budgetPausedUntil) return false;
    const extracted = await this.requirements.runNext(workerId, async (input) => {
      const result = await extractVacancyRequirementsWithFallback(input,
        client ? { extract: async ({ description, instructions }) => (await client.complete({
          runId, task: 'vacancy-requirements', dataClass: 'public', prefix: instructions,
          // 35 entries took ~2 000 tokens on prod (22.10): 50 need headroom, or the JSON is cut.
          input: minimizeModelText(description), maxTokens: 4096,
        }).catch((error: unknown) => {
          if (!(error instanceof Error) || error.message !== BULK_BUDGET_EXCEEDED) throw error;
          const now = new Date();
          this.budgetPausedUntil = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
          this.stats.budgetPaused += 1;
          throw new VacancyRequirementsPausedError(this.budgetPausedUntil);
        })).content } : undefined, (issue) => {
          this.stats.modelIssues = { ...this.stats.modelIssues, [issue]: (this.stats.modelIssues[issue] ?? 0) + 1 };
        });
      if (result.fallbackStatus === 'unavailable') this.stats.requirementsUnavailable += 1;
      else if (result.fallbackStatus === 'invalid') this.stats.requirementsInvalid += 1;
      return result;
    }, Date.now(), minPriority);
    if (extracted) this.stats.requirementsDone += 1;
    return Boolean(extracted);
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
