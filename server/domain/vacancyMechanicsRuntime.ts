import { catchupGate, type CatchupDecision } from './requirementsCatchupGate';
import { minimizeModelText } from '../providers/modelInputPrivacy';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';
import { DatabaseSync } from 'node:sqlite';
import type { VacancyFitFailure, VacancyFitResult, VacancyFitView } from '../../shared/vacancyFit';
import { SqliteVacancyRequirementsStore } from '../data/sqliteVacancyRequirementsStore';
import { SqliteVacancyFitStore, type FitEnqueueOptions } from '../data/sqliteVacancyFitStore';
import { SealedText } from '../data/sealedText';
import { extractVacancyRequirements, extractVacancyRequirementsWithFallback, vacancyDescriptionHash, VacancyRequirementsPausedError, VACANCY_REQUIREMENTS_EXTRACTOR_VERSION } from './vacancyRequirements';
import { labelVacancyRequirement } from './vacancyRequirementLabel';
import { assessVacancyFit, sourcedRequirements, type VacancyFitInput } from './vacancyFit';
import { assessmentFailureLine, createVacancyFitAssessor } from './vacancyFitAssessor';
import { BULK_BUDGET_EXCEEDED, BulkChannelUnavailable, type BulkLlmClient } from '../providers/bulkLlmClient';
import { measuredBulkClient, type BulkCompletion } from './measuredBulkClient';
import {
  addMassRecount, ensureMassRecountTable, massRecountAllowance, massRecountLimit, massRecountQueued, takeMassRecountSlot, utcDay,
  MASS_FIT_DAY_LIMIT, MASS_FIT_REFRESH_DAY_LIMIT, MASS_REQUIREMENTS_DAY_LIMIT, type MassRecountKind,
} from '../data/massRecountDaily';
import { emptyVacancyMechanicsStats, type VacancyMechanicsStats } from './vacancyMechanicsStats';

/** Requirements a fit job is waiting for jump ahead of title-strategy work (priority 1). */
const FIT_DEPENDENCY_PRIORITY = 2;
/** A vacancy a candidate is looking at gets model labels before the background tail (B510). */
export const SHOWN_PAGE_PRIORITY = 1.5;
/** Below a fit the candidate asked for (1), above the maintenance backlog (0). */
const BACKGROUND_REQUIREMENTS_PRIORITY = 0.5;

/** No stage of the channel answers: the worker claims nothing for this long. Short on purpose: no latch (28.10). */
const CHANNEL_PAUSE_MS = 60_000;
/** A job that met the outage waits this long; its attempts stay untouched, so it never turns «failed». */
const CHANNEL_JOB_WAIT_MS = 5 * 60_000;

/**
 * Requirements read before this moment lost their result before the 04.11 census: 119 rows that wait
 * for the owner's decision, since each is a model call for a real candidate. Later ones go back at once.
 */
export const LOST_FIT_RESULTS_REVIVED_SINCE_MS = Date.parse('2026-11-04T15:45:00.000Z');

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
  /** The spend budget refused the call: the job waits for the next UTC day, no attempt is spent. */
  budgetPaused: boolean;
  /** No stage could answer: the job waits in the queue and spends no attempt. */
  channelDown: boolean;
  returned: boolean;
  invalid: boolean;
  /** The stage of the chain that gave the answer: the row records it (04.11). */
  answeredBy: string | null;
}
function assessmentFailure(outcome: AssessmentOutcome): string {
  return outcome.staleProfile
    ? 'profile_changed'
    : outcome.invalid
      ? 'assessment_model_invalid'
      : 'assessment_model_unavailable';
}
/**
 * Every requirement the model is asked about has a verdict in the result. 04.11 prod: a line the text
 * does not hold is never asked about, so comparing every extracted line hid 175 counted rows for good.
 */
function assessesAll(result: VacancyFitResult, resolved: VacancyFitInput): boolean {
  if (result.status !== 'assessed') return true;
  const assessed = new Set(result.assessments.map((item) => item.requirementId));
  return sourcedRequirements(resolved).every((item) => assessed.has(item.id));
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

interface MassRecountOptions {
  readonly now?: number;
  readonly limits?: { readonly requirements?: number; readonly fit?: number };
  readonly log?: { info(line: string): void; warn(line: string): void };
}

/** One info line per kind at every start (also at zero); a warning when the ceiling holds rows back. */
function logMassRecount(log: NonNullable<MassRecountOptions['log']>, kind: MassRecountKind, requeued: number, remaining: number, limit: number, dayTotal: number): void {
  log.info(`mass-recount kind=${kind} requeued=${requeued} remaining=${remaining} limit=${limit}`);
  if (remaining > 0 && dayTotal >= limit) log.warn(`mass-recount-ceiling kind=${kind} queued=${dayTotal} limit=${limit} remaining=${remaining}`);
}

export class VacancyMechanicsRuntime {
  readonly database: DatabaseSync;
  readonly requirements: SqliteVacancyRequirementsStore;
  readonly fit: SqliteVacancyFitStore;
  private stats: VacancyMechanicsStats = emptyVacancyMechanicsStats();
  /** Until the next UTC day after a budget refusal: no job is claimed for a call that would be refused (B556). */
  private budgetPausedUntil = 0;
  private channelPausedUntil = 0;
  constructor(databasePath: string, encryptionKey: Buffer, private readonly validateCurrentProfile?: (input: VacancyFitInput) => boolean) {
    this.database = new DatabaseSync(databasePath);
    applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
    this.requirements = new SqliteVacancyRequirementsStore(this.database);
    this.fit = new SqliteVacancyFitStore(this.database, new SealedText(encryptionKey));
    ensureMassRecountTable(this.database);
  }
  view(input: VacancyFitInput, { queueRequirements = true }: { readonly queueRequirements?: boolean } = {}): VacancyFitView {
    const extracted = this.requirements.getLatestOrLegacy(input.vacancyId, vacancyDescriptionHash(input.description));
    // B510: a shown vacancy without model labels jumps ahead of the background upgrade.
    if (queueRequirements && input.description.trim() && extracted?.extractorVersion !== VACANCY_REQUIREMENTS_EXTRACTOR_VERSION) {
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
    // 02.11 owner: a result that has no verdict for a requirement read from the current text is not
    // shown — its percent was 100 % while the card listed the new requirements as «нет в профиле».
    const result = [current, previous].find((item) => item && assessesAll(item, resolved));
    const state = !input.description.trim()
      ? 'no_description'
      // 01.11: an older extractor's «none» is not the verdict while the model still reads the text.
      : extracted?.status === 'no_requirements' && extracted.extractorVersion === VACANCY_REQUIREMENTS_EXTRACTOR_VERSION
        ? 'no_requirements'
        : result && result === current
          ? 'ready'
          : result
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
  cachedVacancyIds(candidateId: string): ReadonlySet<string> { return this.fit.cachedVacancyIds(candidateId); }
  warmCachedVacancyIds(candidateId: string): Promise<void> { return this.fit.warmCachedVacancyIds(candidateId); }
  /**
   * The current result exists under this input's key, read without opening it (prod 02.11: the
   * selection sweep decrypted every counted row to learn it was counted). The key covers the
   * profile, the text and the current extractor's requirements, so a hit is a current result.
   */
  hasCurrentResult(input: VacancyFitInput): boolean {
    const extracted = this.requirements.getLatestOrLegacy(input.vacancyId, vacancyDescriptionHash(input.description));
    if (!input.description.trim() || extracted?.extractorVersion !== VACANCY_REQUIREMENTS_EXTRACTOR_VERSION) return false;
    return this.fit.hasCache({ ...input, requirements: extracted.requirements });
  }
  /** `enqueue` would create no job: one is waiting, or a finished one holds this input's key and its result stands. */
  fitJobHoldsKey(input: VacancyFitInput): boolean {
    const state = this.fit.getJobState(input);
    return state !== undefined && state !== 'failed' && !this.lostItsResult(input);
  }
  /**
   * The job is finished and no result exists for the requirements as they are now. Requirements not
   * read yet leave the job alone: the worker would only count the old ones again.
   */
  private lostItsResult(input: VacancyFitInput): boolean {
    if (this.fit.getJobState(input) !== 'completed') return false;
    const hash = vacancyDescriptionHash(input.description);
    const extracted = this.requirements.getLatest(input.vacancyId, hash);
    if (!extracted || (this.requirements.latestWrittenAt(input.vacancyId, hash) ?? 0) < LOST_FIT_RESULTS_REVIVED_SINCE_MS) return false;
    const resolved = { ...input, requirements: extracted.requirements };
    return !this.fit.hasCache(resolved) && !this.fit.getCache(resolved);
  }
  /**
   * `backgroundRank` (B580): the selection sweep queues below every page the candidate looks at.
   * `reviveSlot`: a re-read of all requirements loses every result at once, so the sweep counts them
   * under the day's ceiling; a page or a card the candidate opened passes none.
   */
  enqueue(input: VacancyFitInput, options: FitEnqueueOptions & { readonly reviveSlot?: () => boolean } = {}) {
    const requirementInput = { vacancyId: input.vacancyId, description: input.description };
    // This method is reached only by an explicit authenticated POST, never by the worker retry loop.
    this.requirements.retryFailed(requirementInput);
    this.requirements.enqueue(requirementInput, { titleStrategyPriority: options.backgroundRank === undefined ? 1 : BACKGROUND_REQUIREMENTS_PRIORITY });
    this.fit.retryFailed(input, undefined, options);
    if (this.lostItsResult(input) && (options.reviveSlot?.() ?? true)) this.fit.reviveCompleted(input, undefined, options);
    return this.fit.enqueue(input, undefined, options);
  }
  /**
   * Worker start: one requeue of model failures recorded under an older parser revision (B522),
   * capped per UTC day in the database (the worker restarts on every push). Rows over the ceiling
   * stay where they are and are picked up by the first start of a later day.
   */
  requeueAfterParserUpgrade(options: MassRecountOptions = {}): { requirements: number; fit: number; labels: number } {
    const day = utcDay(options.now);
    const log = options.log ?? console;
    const limits = {
      requirements: options.limits?.requirements ?? massRecountLimit('OPENQAREER_MASS_REQUIREMENTS_DAY_LIMIT', MASS_REQUIREMENTS_DAY_LIMIT),
      fit: options.limits?.fit ?? massRecountLimit('OPENQAREER_MASS_FIT_DAY_LIMIT', MASS_FIT_DAY_LIMIT),
    };
    const requirementsLeft = massRecountAllowance(this.database, 'requirements', limits.requirements, day);
    const failures = this.requirements.requeueModelFailures(undefined, options.now, requirementsLeft);
    const labels = this.requirements.enqueueLabelUpgrades(options.now, requirementsLeft - failures);
    addMassRecount(this.database, 'requirements', day, failures + labels);
    const fitLeft = massRecountAllowance(this.database, 'fit', limits.fit, day);
    const nowIso = options.now === undefined ? undefined : new Date(options.now).toISOString();
    const failed = this.fit.requeueFailedOnce(undefined, nowIso, fitLeft);
    const orphaned = this.fit.requeueOrphanedRequirementsTimeouts(nowIso, fitLeft - failed);
    const fit = failed + orphaned;
    addMassRecount(this.database, 'fit', day, fit);
    const requirementsRemaining = this.requirements.countModelFailures() + this.requirements.countLabelUpgradeCandidates();
    const total = (kind: MassRecountKind) => massRecountQueued(this.database, kind, day);
    logMassRecount(log, 'requirements', failures + labels, requirementsRemaining, limits.requirements, total('requirements'));
    logMassRecount(log, 'fit', fit, this.fit.countFailedOnce() + this.fit.countOrphanedRequirementsTimeouts(), limits.fit, total('fit'));
    return { requirements: failures, fit, labels };
  }
  /** The background refresh of counted rows (a new algorithm version): true while the day's ceiling has room. */
  takeFitRefreshSlot(limit = massRecountLimit('OPENQAREER_MASS_FIT_REFRESH_DAY_LIMIT', MASS_FIT_REFRESH_DAY_LIMIT)): boolean {
    return takeMassRecountSlot(this.database, 'fit_refresh', limit);
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
    // B556 for the fit call too (01.11): no fit job is claimed for a call the budget would refuse.
    if (client && Date.now() < Math.max(this.budgetPausedUntil, this.channelPausedUntil)) return shown;
    const job = this.fit.claim({ leaseMs: 300000 });
    if (!job) return shown || (await this.extractNextRequirements(client, runId, workerId, undefined, true));
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
      if (!requirements && Date.now() < this.channelPausedUntil) {
        // Its requirements could not be read for the same outage: a defer would run out and fail it.
        this.waitForChannel(job);
        return Boolean(extracted);
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
      this.settleAssessment(job, resolved, result, outcome, Boolean(client));
    } catch (error) {
      this.settleFailure(job, error instanceof Error && /^[a-z0-9_:-]{1,80}$/iu.test(error.message) ? error.message : 'assessment_failed', job.attempts < 3);
    }
    return true;
  }

  /** Where the job goes after its model call. */
  private settleAssessment(job: Parameters<SqliteVacancyFitStore['pause']>[0], resolved: VacancyFitInput, result: VacancyFitResult, outcome: AssessmentOutcome, hasClient: boolean): void {
    if (outcome.budgetPaused) {
      this.pauseForBudget();
      this.fit.pause(job, new Date(this.budgetPausedUntil).toISOString(), 'assessment_budget_paused');
    } else if (outcome.channelDown) {
      this.pauseForChannel();
      this.waitForChannel(job);
    } else if (hasClient && result.reason === 'assessment_unavailable' && !outcome.returned) {
      this.settleFailure(job, assessmentFailure(outcome), !outcome.staleProfile && job.attempts < 3);
    } else if (this.fit.complete(job, result, undefined, resolved, outcome.answeredBy)) this.stats.completed += 1;
  }

  /** The fit assessor with what happened to its call: the failure class names the row (B562-r). */
  private trackedAssessor(
    client: BulkCompletion | null,
    runId: string,
    resolved: VacancyFitInput,
  ) {
    const outcome: AssessmentOutcome = { staleProfile: false, budgetPaused: false, channelDown: false, returned: false, invalid: false, answeredBy: null };
    const base = client
      ? createVacancyFitAssessor({
          complete: async (request) => {
            const answer = await client.complete(request);
            if (answer.provider && answer.model) outcome.answeredBy = `${answer.provider} ${answer.model}`;
            return answer;
          },
        }, runId)
      : undefined;
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
              console.warn(assessmentFailureLine(resolved.vacancyId, error));
              if (error instanceof Error && error.message === BULK_BUDGET_EXCEEDED) {
                outcome.budgetPaused = true;
                throw error;
              }
              if (error instanceof BulkChannelUnavailable) {
                outcome.channelDown = true;
                throw error;
              }
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
  private async extractNextRequirements(client: BulkCompletion | null, runId: string, workerId: string, minPriority = Number.NEGATIVE_INFINITY, background = false): Promise<boolean> {
    if (client && Date.now() < Math.max(this.budgetPausedUntil, this.channelPausedUntil)) return false;
    const extracted = await this.requirements.runNext(workerId, async (input) => {
      // B642: the background tail of old-but-alive vacancies has its own $2/day; over it the job waits.
      const gate = background ? this.catchupDecision(input.vacancyId) : { task: 'vacancy-requirements' };
      if (gate.deferUntil !== undefined) {
        this.stats.catchupDeferred += 1;
        throw new VacancyRequirementsPausedError(gate.deferUntil);
      }
      const result = await extractVacancyRequirementsWithFallback(input,
        client ? { extract: async ({ description, instructions }) => (await client.complete({
          runId, task: gate.task, dataClass: 'public', prefix: instructions,
          // 35 entries took ~2 000 tokens on prod (22.10): 50 need headroom, or the JSON is cut.
          input: minimizeModelText(description), maxTokens: 4096,
        }).catch((error: unknown) => {
          if (error instanceof BulkChannelUnavailable) {
            this.pauseForChannel();
            throw new VacancyRequirementsPausedError(Date.now() + CHANNEL_JOB_WAIT_MS);
          }
          if (!(error instanceof Error) || error.message !== BULK_BUDGET_EXCEEDED) throw error;
          this.pauseForBudget();
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

  /** B642: catch-up gate; a database without the pool tables (tests, desktop) runs as before. */
  private catchupDecision(vacancyId: string): CatchupDecision {
    try {
      return catchupGate(this.database, vacancyId);
    } catch {
      return { task: 'vacancy-requirements' };
    }
  }

  /** Until the next UTC day: the day's run is spent (B556). */
  private pauseForBudget(): void {
    const now = new Date();
    this.budgetPausedUntil = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    this.stats.budgetPaused += 1;
  }

  /** Not the 28.10 latch: a minute, and each new call tries the channel again. */
  private pauseForChannel(): void {
    this.channelPausedUntil = Date.now() + CHANNEL_PAUSE_MS;
    this.stats.channelPaused += 1;
  }

  private waitForChannel(job: Parameters<SqliteVacancyFitStore['pause']>[0]): void {
    this.fit.pause(job, new Date(Date.now() + CHANNEL_JOB_WAIT_MS).toISOString(), 'assessment_model_unavailable');
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
