import { randomUUID } from 'node:crypto';
import {
  CandidateActionLimitError,
  CandidateConsentRequiredError,
  CandidateRunnerNotConnectedError,
} from './candidateActionExecutor';
import type { CandidateActionExecutor, ExecuteBatchInput } from './candidateActionExecutor';
import {
  dailyCandidateAutomationLimit,
  isCandidateAutomationWindowOpen,
  nextCandidateAutomationSendAt,
  type CandidateAutomationPlatform,
  type CandidateAutomationSchedule,
} from './candidateAutomationScheduler';
import { companyStopKey } from '../domain/candidateAutomation';
import { formatLocalDate, getCandidateActionResetAt } from '../../shared/candidateActionPolicy';
import type {
  CandidateAutomationQueueItem,
  SqliteCandidateAutomationRepository,
} from './sqliteCandidateAutomationRepository';
import type { StoredActionReceipt } from './sqliteCandidateActionRepository';

export type CandidateAutomationDispatchStatus =
  | 'waiting'
  | 'delivered'
  | 'error'
  | 'paused'
  | 'daily_limit_reached'
  | 'linkedin_not_connected'
  | 'prepared'
  | 'idle'
  | 'leased';

export interface CandidateAutomationDispatchResult {
  readonly candidateId: string;
  readonly status: CandidateAutomationDispatchStatus;
  readonly queueItemId?: string;
  readonly receiptId?: string;
  readonly nextSendAt?: string | null;
  readonly failureCode?: string | null;
}

type DispatchExecutor = Pick<CandidateActionExecutor, 'executeBatch'> &
  Partial<Pick<CandidateActionExecutor, 'findStoredReceipt'>>;

export class CandidateAutomationDispatch {
  private readonly repository: SqliteCandidateAutomationRepository;
  private readonly executor?: DispatchExecutor;
  private readonly random: () => number;

  constructor(options: {
    readonly repository: SqliteCandidateAutomationRepository;
    readonly executor?: DispatchExecutor;
    readonly random?: () => number;
  }) {
    this.repository = options.repository;
    this.executor = options.executor;
    this.random = options.random ?? Math.random;
  }

  async runDue(
    now = new Date(),
    limit = 50,
  ): Promise<readonly CandidateAutomationDispatchResult[]> {
    const ids = this.repository.schedulerRepository.listDueCandidateIds(now.toISOString(), limit);
    const results: CandidateAutomationDispatchResult[] = [];
    for (const candidateId of ids) results.push(await this.runCandidate(candidateId, now));
    return results;
  }

  async runCandidate(
    candidateId: string,
    now = new Date(),
  ): Promise<CandidateAutomationDispatchResult> {
    const token = randomUUID();
    const nowIso = now.toISOString();
    if (
      !this.repository.schedulerRepository.claimCandidate(candidateId, token, nowIso, leaseEnd(now))
    ) {
      return { candidateId, status: 'leased' };
    }
    try {
      return await this.runClaimedCandidate(candidateId, now);
    } finally {
      this.repository.schedulerRepository.releaseCandidate(candidateId, token, nowIso);
    }
  }

  private async runClaimedCandidate(
    candidateId: string,
    now: Date,
  ): Promise<CandidateAutomationDispatchResult> {
    const settings = this.repository.getSettings(candidateId);
    const runtime = this.repository.schedulerRepository.getRuntime(candidateId);
    const schedule = this.repository.schedulerRepository.getSchedule(candidateId);
    if (!settings.enabled || settings.mode !== 'approval_required')
      return this.prepared(candidateId, now);
    if (isPaused(settings.pausedUntil, now) || runtime.emergencyPaused)
      return this.pauseResult(candidateId, runtime.pauseUntil);
    if (!hasAutomationConsent(this.repository, candidateId))
      return this.requireConsent(candidateId, now);
    if (runtime.consecutiveErrors >= schedule.stopAfterErrors)
      return this.blockAfterErrors(candidateId, runtime);
    return this.processNextApproved(candidateId, now, schedule);
  }

  private async processNextApproved(
    candidateId: string,
    now: Date,
    schedule: CandidateAutomationSchedule,
  ): Promise<CandidateAutomationDispatchResult> {
    const item = this.repository.getNextApprovedQueueItem(candidateId);
    if (!item) return { candidateId, status: 'idle' };
    if (!matchesCurrentRules(this.repository, candidateId, item))
      return this.prepared(candidateId, now, item.id);
    const runtime = this.repository.schedulerRepository.getRuntime(candidateId);
    const dueAt = runtime.nextSendAt
      ? new Date(runtime.nextSendAt)
      : initialDueAt(item, schedule, this.random);
    if (dueAt.getTime() > now.getTime()) return this.wait(candidateId, dueAt, item.id, now);
    if (!isCandidateAutomationWindowOpen(now, item.payload.platform, schedule)) {
      return this.wait(
        candidateId,
        nextCandidateAutomationSendAt(now, item.payload.platform, schedule, this.random),
        item.id,
        now,
      );
    }
    return this.sendApprovedItem(candidateId, item, now, schedule);
  }

  private async sendApprovedItem(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    now: Date,
    schedule: CandidateAutomationSchedule,
  ): Promise<CandidateAutomationDispatchResult> {
    const localDate = formatLocalDate(now, schedule.timezone);
    const used = this.repository.schedulerRepository.countDailyAttempts(
      candidateId,
      localDate,
      item.payload.platform,
    );
    if (
      used >= dailyCandidateAutomationLimit(candidateId, localDate, item.payload.platform, schedule)
    ) {
      return this.pauseAtDailyLimit(candidateId, now, schedule, item.payload.platform, item.id);
    }
    if (!this.executor) return this.prepared(candidateId, now, item.id);
    const existing = this.executor.findStoredReceipt?.(candidateId, item.id);
    if (existing) return this.handleReceipt(candidateId, item, existing, now, schedule, localDate);
    return this.executeItem(candidateId, item, now, schedule, localDate);
  }

  private async executeItem(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    now: Date,
    schedule: CandidateAutomationSchedule,
    localDate: string,
  ): Promise<CandidateAutomationDispatchResult> {
    try {
      const result = await this.executor!.executeBatch({
        candidateId,
        batchId: item.id,
        confirmedByCandidate: true,
        actions: [actionFromQueueItem(item)],
        nowIso: now.toISOString(),
        clientTimezone: schedule.timezone,
        beforeExecute: () => this.canExecuteApprovedItem(candidateId, item.id, now),
      });
      const receipt = result.receipts[0];
      if (!receipt)
        return this.recordUnreceiptedFailure(
          candidateId,
          item,
          now,
          localDate,
          'executor_no_receipt',
        );
      return this.handleReceipt(candidateId, item, receipt, now, schedule, localDate);
    } catch (error: unknown) {
      return this.handleExecutorError(candidateId, item, error, now, schedule, localDate);
    }
  }

  private handleExecutorError(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    error: unknown,
    now: Date,
    schedule: CandidateAutomationSchedule,
    localDate: string,
  ): CandidateAutomationDispatchResult {
    if (error instanceof CandidateActionLimitError) {
      return error.reason === 'daily_limit_reached'
        ? this.pauseAtDailyLimit(candidateId, now, schedule, item.payload.platform, item.id)
        : this.wait(
            candidateId,
            nextCandidateAutomationSendAt(now, item.payload.platform, schedule, this.random),
            item.id,
            now,
          );
    }
    if (error instanceof CandidateConsentRequiredError) {
      return this.handleConsentGuardFailure(candidateId, item.id, now);
    }
    if (error instanceof CandidateRunnerNotConnectedError) {
      return this.recordUnconnected(
        candidateId,
        item,
        now,
        localDate,
        item.payload.platform === 'linkedin',
      );
    }
    const existing = this.executor?.findStoredReceipt?.(candidateId, item.id);
    if (existing) return this.handleReceipt(candidateId, item, existing, now, schedule, localDate);
    return this.recordUnreceiptedFailure(candidateId, item, now, localDate, safeFailureCode(error));
  }

  private handleReceipt(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    receipt: StoredActionReceipt,
    now: Date,
    schedule: CandidateAutomationSchedule,
    localDate: string,
  ): CandidateAutomationDispatchResult {
    const action =
      receipt.status === 'delivered'
        ? 'sent'
        : receipt.status === 'attempted' || receipt.status === 'pending'
          ? 'attempted'
          : 'failed';
    this.repository.completeScheduledQueueItem({
      candidateId,
      queueItemId: item.id,
      action,
      localDate,
      occurredAt: now.toISOString(),
      receiptId: receipt.id,
      failureCode: receipt.failureCode ?? pendingFailureCode(receipt),
      receiptStatus: receipt.status,
      attempted: true,
    });
    return action === 'sent'
      ? this.recordDelivery(candidateId, item, now, schedule, receipt.id)
      : this.recordFailure(
          candidateId,
          item,
          now,
          schedule,
          receipt.id,
          receipt.failureCode ?? 'provider_error',
        );
  }

  private canExecuteApprovedItem(candidateId: string, queueItemId: string, now: Date): boolean {
    const settings = this.repository.getSettings(candidateId);
    const runtime = this.repository.schedulerRepository.getRuntime(candidateId);
    const item = this.repository.getQueueItem(candidateId, queueItemId);
    return settings.enabled && settings.mode === 'approval_required' &&
      hasAutomationConsent(this.repository, candidateId) && !isPaused(settings.pausedUntil, now) &&
      !runtime.emergencyPaused && item?.status === 'approved';
  }

  private handleConsentGuardFailure(
    candidateId: string,
    queueItemId: string,
    now: Date,
  ): CandidateAutomationDispatchResult {
    const settings = this.repository.getSettings(candidateId);
    const runtime = this.repository.schedulerRepository.getRuntime(candidateId);
    const item = this.repository.getQueueItem(candidateId, queueItemId);
    const code = !hasAutomationConsent(this.repository, candidateId)
      ? 'automation_consent_required'
      : !settings.enabled || settings.mode !== 'approval_required' || isPaused(settings.pausedUntil, now) || runtime.emergencyPaused
        ? 'automation_paused'
        : item?.status !== 'approved'
          ? 'approval_no_longer_current'
          : 'actions_on_behalf_consent_required';
    return this.requireConsent(candidateId, now, code);
  }

  private recordDelivery(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    now: Date,
    schedule: CandidateAutomationSchedule,
    receiptId: string,
  ): CandidateAutomationDispatchResult {
    const runtime = this.repository.schedulerRepository.getRuntime(candidateId);
    const sentSinceBreak = runtime.sentSinceBreak + 1;
    const breakDue = sentSinceBreak >= schedule.breakAfterSent;
    const availableAt = breakDue ? new Date(now.getTime() + schedule.breakMinutes * 60_000) : now;
    const next = nextCandidateAutomationSendAt(
      availableAt,
      item.payload.platform,
      schedule,
      this.random,
    );
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        nextSendAt: next.toISOString(),
        pauseUntil: breakDue ? availableAt.toISOString() : null,
        status: 'waiting',
        sentSinceBreak: breakDue ? 0 : sentSinceBreak,
        consecutiveErrors: 0,
        lastFailureCode: null,
      },
      now.toISOString(),
    );
    return {
      candidateId,
      status: 'delivered',
      queueItemId: item.id,
      receiptId,
      nextSendAt: next.toISOString(),
    };
  }

  private recordFailure(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    now: Date,
    schedule: CandidateAutomationSchedule,
    receiptId: string,
    failureCode: string,
  ): CandidateAutomationDispatchResult {
    const previous = this.repository.schedulerRepository.getRuntime(candidateId);
    const errors = previous.consecutiveErrors + 1;
    const stopped = errors >= schedule.stopAfterErrors;
    const next = stopped
      ? null
      : nextCandidateAutomationSendAt(
          now,
          item.payload.platform,
          schedule,
          this.random,
        ).toISOString();
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        nextSendAt: next,
        pauseUntil: stopped ? null : next,
        status: stopped ? 'error' : 'waiting',
        consecutiveErrors: errors,
        lastFailureCode: failureCode,
      },
      now.toISOString(),
    );
    return {
      candidateId,
      status: 'error',
      queueItemId: item.id,
      receiptId,
      nextSendAt: next,
      failureCode,
    };
  }

  private recordUnconnected(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    now: Date,
    localDate: string,
    linkedin: boolean,
  ): CandidateAutomationDispatchResult {
    const status = linkedin ? 'linkedin_not_connected' : 'prepared';
    const code = linkedin ? 'linkedin_not_connected' : 'candidate_session_not_connected';
    this.repository.schedulerRepository.appendJournalEntry({
      candidateId,
      queueItemId: item.id,
      platform: item.payload.platform,
      result: 'error',
      attempted: false,
      localDate,
      company: item.payload.company,
      occurredAt: now.toISOString(),
      failureCode: code,
      eventKey: `${item.id}:${code}:${now.toISOString()}`,
    });
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        nextSendAt: null,
        pauseUntil: null,
        status,
        lastFailureCode: code,
      },
      now.toISOString(),
    );
    return { candidateId, status, queueItemId: item.id, nextSendAt: null, failureCode: code };
  }

  private recordUnreceiptedFailure(
    candidateId: string,
    item: CandidateAutomationQueueItem,
    now: Date,
    localDate: string,
    failureCode: string,
  ): CandidateAutomationDispatchResult {
    this.repository.schedulerRepository.appendJournalEntry({
      candidateId,
      queueItemId: item.id,
      platform: item.payload.platform,
      result: 'error',
      receiptStatus: 'pending',
      attempted: true,
      localDate,
      company: item.payload.company,
      occurredAt: now.toISOString(),
      failureCode,
      eventKey: `${item.id}:${failureCode}:${now.toISOString()}`,
    });
    const runtime = this.repository.schedulerRepository.getRuntime(candidateId);
    const errors = runtime.consecutiveErrors + 1;
    const stopped =
      errors >= this.repository.schedulerRepository.getSchedule(candidateId).stopAfterErrors;
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        nextSendAt: null,
        pauseUntil: null,
        status: stopped ? 'error' : 'paused',
        consecutiveErrors: errors,
        lastFailureCode: failureCode,
      },
      now.toISOString(),
    );
    return { candidateId, status: 'error', queueItemId: item.id, failureCode, nextSendAt: null };
  }

  private pauseAtDailyLimit(
    candidateId: string,
    now: Date,
    schedule: CandidateAutomationSchedule,
    platform: CandidateAutomationPlatform,
    queueItemId: string,
  ): CandidateAutomationDispatchResult {
    const next = getCandidateActionResetAt(now, schedule.timezone);
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        nextSendAt: next,
        pauseUntil: next,
        status: 'daily_limit_reached',
        lastFailureCode: 'daily_limit_reached',
      },
      now.toISOString(),
    );
    return {
      candidateId,
      status: 'daily_limit_reached',
      queueItemId,
      nextSendAt: next,
      failureCode: `${platform}_daily_limit`,
    };
  }

  private wait(
    candidateId: string,
    next: Date,
    queueItemId: string,
    now: Date,
  ): CandidateAutomationDispatchResult {
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        nextSendAt: next.toISOString(),
        pauseUntil: null,
        status: 'waiting',
      },
      now.toISOString(),
    );
    return { candidateId, status: 'waiting', queueItemId, nextSendAt: next.toISOString() };
  }

  private prepared(
    candidateId: string,
    now: Date,
    queueItemId?: string,
  ): CandidateAutomationDispatchResult {
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        status: 'prepared',
        nextSendAt: null,
      },
      now.toISOString(),
    );
    return { candidateId, status: 'prepared', ...(queueItemId ? { queueItemId } : {}) };
  }

  private pauseResult(
    candidateId: string,
    pauseUntil: string | null,
  ): CandidateAutomationDispatchResult {
    return { candidateId, status: 'paused', nextSendAt: pauseUntil };
  }

  private requireConsent(
    candidateId: string,
    now: Date,
    failureCode = 'automation_consent_required',
  ): CandidateAutomationDispatchResult {
    this.repository.schedulerRepository.setRuntime(
      candidateId,
      {
        status: 'paused',
        nextSendAt: null,
        lastFailureCode: failureCode,
      },
      now.toISOString(),
    );
    return { candidateId, status: 'paused', failureCode };
  }

  private blockAfterErrors(
    candidateId: string,
    runtime: ReturnType<SqliteCandidateAutomationRepository['schedulerRepository']['getRuntime']>,
  ): CandidateAutomationDispatchResult {
    return { candidateId, status: 'error', nextSendAt: null, failureCode: runtime.lastFailureCode };
  }
}

function initialDueAt(
  item: CandidateAutomationQueueItem,
  schedule: CandidateAutomationSchedule,
  random: () => number,
): Date {
  return nextCandidateAutomationSendAt(
    new Date(item.updatedAt),
    item.payload.platform,
    schedule,
    random,
  );
}

function actionFromQueueItem(
  item: CandidateAutomationQueueItem,
): ExecuteBatchInput['actions'][number] {
  return {
    id: item.id,
    platform: item.payload.platform,
    actionKind: item.payload.platform === 'hh' ? 'hh_apply' : 'linkedin_easy_apply',
    applicationId: item.applicationId,
    targetUrl: item.payload.targetUrl,
    letterText: item.payload.letterText,
  };
}

function matchesCurrentRules(
  repository: SqliteCandidateAutomationRepository,
  candidateId: string,
  item: CandidateAutomationQueueItem,
): boolean {
  const settings = repository.getSettings(candidateId);
  if (!settings.rules.platforms.includes(item.payload.platform)) return false;
  if (!settings.rules.excludeStopCompanies) return true;
  const key = companyStopKey(item.payload.company);
  return !key || !repository.listStopCompanyKeys(candidateId).has(key);
}

function hasAutomationConsent(
  repository: SqliteCandidateAutomationRepository,
  candidateId: string,
): boolean {
  return repository.hasActiveConsent(candidateId, 'send_after_approval');
}

function isPaused(pausedUntil: string | null, now: Date): boolean {
  return Boolean(pausedUntil && Date.parse(pausedUntil) > now.getTime());
}

function pendingFailureCode(receipt: StoredActionReceipt): string | null {
  return receipt.status === 'pending' ? 'executor_receipt_pending' : null;
}

function safeFailureCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : 'executor_failure';
}

function leaseEnd(now: Date): string {
  return new Date(now.getTime() + 5 * 60_000).toISOString();
}
