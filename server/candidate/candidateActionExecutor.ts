import { randomUUID } from 'node:crypto';
import {
  classifyLinkedinSafetyStopReason,
  type CandidateActionKind,
  checkActionCapacity,
} from '../../shared/candidateActionPolicy';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatLocalDate,
  isValidTimezone,
} from '../../shared/timezoneUtils';
import type { SqliteCandidateActionRepository, StoredActionReceipt } from './sqliteCandidateActionRepository';
import type { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';

/** Process-local guard matches the single service process; use a shared lock before scaling. */
const LINKEDIN_CANDIDATES_IN_FLIGHT = new Set<string>();

export interface CandidateApplicationTracker {
  getApplication(candidateId: string, applicationId: string): { version: number; stage: string } | null;
  patchApplication(
    candidateId: string,
    applicationId: string,
    input: { expectedVersion: number; stage?: string; occurredAt?: string },
  ): unknown;
  recordApplicationEvent(
    candidateId: string,
    applicationId: string,
    input: { kind: 'follow_up_sent' | 'thank_you_sent' | 'promise'; occurredAt: string; note?: string | null },
  ): unknown;
}

export class CandidateConfirmationRequiredError extends Error {
  constructor() {
    super('Действия требуют обязательного подтверждения кандидатом');
    this.name = 'CandidateConfirmationRequiredError';
  }
}

export class CandidateConsentRequiredError extends Error {
  constructor() {
    super('Требуется согласие кандидата на действия от его имени (actions_on_behalf)');
    this.name = 'CandidateConsentRequiredError';
  }
}

/** Нет подключённого исполнителя площадки: пакет не отправляется и не записывается. */
export class CandidateRunnerNotConnectedError extends Error {
  constructor() {
    super('Отправка на площадку ещё не подключена');
    this.name = 'CandidateRunnerNotConnectedError';
  }
}

export interface CandidateActionItem {
  readonly id?: string;
  readonly platform: 'hh' | 'linkedin';
  readonly actionKind: CandidateActionKind;
  readonly applicationId?: string | null;
  readonly targetUrl: string;
  readonly letterVersion?: string | null;
  readonly letterText?: string | null;
  readonly resumeVersion?: string | null;
  readonly resumeId?: string | null;
}

export interface CandidateActionResult {
  readonly status: 'delivered' | 'attempted';
  readonly confirmationUrl?: string | null;
  readonly snapshotHash?: string | null;
  readonly failureCode?: string | null;
}

export interface CandidatePlatformRunner {
  executeAction(
    candidateId: string,
    action: CandidateActionItem,
  ): Promise<CandidateActionResult>;
}

export class SimulatedCandidatePlatformRunner implements CandidatePlatformRunner {
  constructor(
    private readonly defaultOutcome: CandidateActionResult = { status: 'delivered' },
    private readonly outcomeOverrides?: Map<string, CandidateActionResult>,
  ) {}

  async executeAction(
    _candidateId: string,
    action: CandidateActionItem,
  ): Promise<CandidateActionResult> {
    if (this.outcomeOverrides && action.id && this.outcomeOverrides.has(action.id)) {
      return this.outcomeOverrides.get(action.id)!;
    }
    return this.defaultOutcome;
  }
}

export interface ExecuteBatchInput {
  readonly candidateId: string;
  readonly confirmedByCandidate: boolean;
  readonly actions: readonly CandidateActionItem[];
  readonly nowIso?: string;
  readonly clientTimezone?: string;
}

export interface ExecuteBatchResult {
  readonly batchId: string;
  readonly status: 'completed' | 'partial_failure' | 'aborted';
  readonly receipts: readonly StoredActionReceipt[];
}

export interface CandidateActionExecutorOptions {
  readonly repository: SqliteCandidateActionRepository;
  readonly runner?: CandidatePlatformRunner;
  readonly consentStore?: SqliteCapabilityConsentStore;
  readonly applicationTracker?: CandidateApplicationTracker;
  readonly userTimezoneLookup?: (candidateId: string) => Promise<string | undefined> | string | undefined;
}

export class CandidateActionExecutor {
  private readonly repository: SqliteCandidateActionRepository;
  private readonly runner: CandidatePlatformRunner | null;
  private readonly consentStore?: SqliteCapabilityConsentStore;
  private readonly applicationTracker?: CandidateApplicationTracker;
  private readonly userTimezoneLookup?: (candidateId: string) => Promise<string | undefined> | string | undefined;

  constructor(options: CandidateActionExecutorOptions) {
    this.repository = options.repository;
    this.runner = options.runner ?? null;
    this.consentStore = options.consentStore;
    this.applicationTracker = options.applicationTracker;
    this.userTimezoneLookup = options.userTimezoneLookup;
  }

  async executeBatch(input: ExecuteBatchInput): Promise<ExecuteBatchResult> {
    this.assertConfirmation(input.confirmedByCandidate);
    this.assertConsent(input.candidateId);
    const runner = this.runner;
    if (!runner) throw new CandidateRunnerNotConnectedError();

    const nowIso = input.nowIso ?? new Date().toISOString();
    const timezone = await this.resolveTimezone(input.candidateId, input.clientTimezone);
    const localDate = formatLocalDate(new Date(nowIso), timezone);

    const batchId = randomUUID();
    this.repository.createBatch(batchId, input.candidateId, nowIso);

    const receipts: StoredActionReceipt[] = [];
    for (const action of input.actions) {
      const receipt = await this.executeActionItem({
        action,
        candidateId: input.candidateId,
        batchId,
        nowIso,
        timezone,
        localDate,
      });
      receipts.push(receipt);
    }

    const status = this.calculateBatchStatus(receipts);
    this.repository.updateBatchStatus(batchId, status);
    return { batchId, status, receipts };
  }

  private assertConfirmation(confirmedByCandidate: boolean): void {
    if (!confirmedByCandidate) {
      throw new CandidateConfirmationRequiredError();
    }
  }

  private assertConsent(candidateId: string): void {
    if (!this.consentStore) return;
    const consent = this.consentStore.getActiveConsent(candidateId, 'actions_on_behalf');
    if (!consent) {
      throw new CandidateConsentRequiredError();
    }
  }

  private async resolveTimezone(candidateId: string, clientTimezone?: string): Promise<string> {
    if (this.userTimezoneLookup) {
      const found = await this.userTimezoneLookup(candidateId);
      if (found && isValidTimezone(found)) return found;
    }
    if (clientTimezone && isValidTimezone(clientTimezone)) {
      return clientTimezone;
    }
    return DEFAULT_ACCOUNT_TIMEZONE;
  }

  private calculateBatchStatus(receipts: readonly StoredActionReceipt[]): 'completed' | 'partial_failure' | 'aborted' {
    if (receipts.length === 0) return 'completed';
    const deliveredCount = receipts.filter((r) => r.status === 'delivered').length;
    if (deliveredCount === receipts.length) return 'completed';
    if (deliveredCount === 0) return 'aborted';
    return 'partial_failure';
  }

  private async executeActionItem(params: {
    action: CandidateActionItem;
    candidateId: string;
    batchId: string;
    nowIso: string;
    timezone: string;
    localDate: string;
  }): Promise<StoredActionReceipt> {
    const { action, candidateId, nowIso, timezone, localDate } = params;

    if (this.repository.isKillSwitchActive(action.platform, candidateId)) {
      return this.handleAttemptedAction(params, 'kill_switch_active');
    }

    const dailyUsage = this.repository.getDailyUsage(candidateId, localDate);
    const capacity = checkActionCapacity(
      action.actionKind,
      new Date(nowIso),
      timezone,
      dailyUsage,
    );

    if (!capacity.allowed) {
      return this.handleAttemptedAction(params, capacity.code ?? 'capacity_blocked');
    }

    return this.performRunnerExecution(params);
  }

  private async performRunnerExecution(params: {
    action: CandidateActionItem;
    candidateId: string;
    batchId: string;
    nowIso: string;
    localDate: string;
  }): Promise<StoredActionReceipt> {
    const { action, candidateId } = params;
    const linkedin = action.platform === 'linkedin';
    if (linkedin && LINKEDIN_CANDIDATES_IN_FLIGHT.has(candidateId)) {
      return this.handleAttemptedAction(params, 'linkedin_action_in_progress');
    }
    if (linkedin) LINKEDIN_CANDIDATES_IN_FLIGHT.add(candidateId);
    try {
      const result = await this.runner!.executeAction(candidateId, action);
      if (result.status === 'delivered') {
        return this.handleDeliveredAction(params, result);
      }
      if (action.platform === 'linkedin') {
        const reason = classifyLinkedinSafetyStopReason(result.failureCode);
        this.repository.setKillSwitch(`candidate:${candidateId}:linkedin`, true, reason);
        return this.handleAttemptedAction(params, reason);
      }
      return this.handleAttemptedAction(params, result.failureCode ?? 'execution_failed', result);
    } catch (err) {
      if (action.platform === 'linkedin') {
        const reason = classifyLinkedinSafetyStopReason(err instanceof Error ? err.message : undefined);
        this.repository.setKillSwitch(`candidate:${candidateId}:linkedin`, true, reason);
        return this.handleAttemptedAction(params, reason);
      }
      const message = err instanceof Error ? err.message : 'unhandled_execution_error';
      return this.handleAttemptedAction(params, message);
    } finally {
      if (linkedin) LINKEDIN_CANDIDATES_IN_FLIGHT.delete(candidateId);
    }
  }

  private handleDeliveredAction(
    params: { action: CandidateActionItem; candidateId: string; batchId: string; nowIso: string; localDate: string },
    result: CandidateActionResult,
  ): StoredActionReceipt {
    const { action, candidateId, batchId, nowIso, localDate } = params;
    this.repository.recordActionUsage(candidateId, localDate, action.actionKind, nowIso);
    const receipt = this.repository.recordReceipt({
      id: action.id,
      batchId,
      candidateId,
      platform: action.platform,
      actionKind: action.actionKind,
      status: 'delivered',
      applicationId: action.applicationId,
      targetUrl: action.targetUrl,
      confirmationUrl: result.confirmationUrl,
      snapshotHash: result.snapshotHash,
      letterVersion: action.letterVersion,
      letterText: action.letterText,
      resumeVersion: action.resumeVersion,
      resumeId: action.resumeId,
      executedAt: nowIso,
    });
    this.advanceApplicationToApplied(candidateId, action.applicationId, nowIso);
    return receipt;
  }

  private handleAttemptedAction(
    params: { action: CandidateActionItem; candidateId: string; batchId: string; nowIso: string },
    failureCode: string,
    result?: CandidateActionResult,
  ): StoredActionReceipt {
    const { action, candidateId, batchId, nowIso } = params;
    const receipt = this.repository.recordReceipt({
      id: action.id,
      batchId,
      candidateId,
      platform: action.platform,
      actionKind: action.actionKind,
      status: 'attempted',
      failureCode,
      applicationId: action.applicationId,
      targetUrl: action.targetUrl,
      confirmationUrl: result?.confirmationUrl,
      snapshotHash: result?.snapshotHash,
      letterVersion: action.letterVersion,
      letterText: action.letterText,
      resumeVersion: action.resumeVersion,
      resumeId: action.resumeId,
      executedAt: nowIso,
    });
    this.recordApplicationAttemptNote(candidateId, action.applicationId, action.actionKind, failureCode, nowIso);
    return receipt;
  }

  private advanceApplicationToApplied(candidateId: string, applicationId: string | null | undefined, nowIso: string): void {
    if (!this.applicationTracker || !applicationId) return;
    try {
      const app = this.applicationTracker.getApplication(candidateId, applicationId);
      if (app && app.stage !== 'applied') {
        this.applicationTracker.patchApplication(candidateId, applicationId, {
          expectedVersion: app.version,
          stage: 'applied',
          occurredAt: nowIso,
        });
      }
    } catch {
      // Graceful ignore
    }
  }

  private recordApplicationAttemptNote(
    candidateId: string,
    applicationId: string | null | undefined,
    actionKind: CandidateActionKind,
    failureCode: string,
    nowIso: string,
  ): void {
    if (!this.applicationTracker || !applicationId) return;
    try {
      this.applicationTracker.recordApplicationEvent(candidateId, applicationId, {
        kind: 'promise',
        occurredAt: nowIso,
        note: `Попытка действия ${actionKind} не завершена: ${failureCode}`,
      });
    } catch {
      // Graceful ignore
    }
  }
}
