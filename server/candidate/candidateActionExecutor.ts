import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import {
  type CandidateActionKind,
  checkActionCapacity,
  getCandidateActionPauseMs,
  isAllowedCandidateActionTarget,
  MAX_CANDIDATE_ACTIONS_PER_BATCH,
} from '../../shared/candidateActionPolicy';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatLocalDate,
  isValidTimezone,
} from '../../shared/timezoneUtils';
import type { SqliteCandidateActionRepository, StoredActionReceipt } from './sqliteCandidateActionRepository';
import type { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';

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

export class CandidateRunnerNotConnectedError extends Error {
  readonly code = 'runner_not_connected';

  constructor(message = 'Исполнитель действий не подключён к сессии на этом устройстве. Действия не запускались.') {
    super(message);
    this.name = 'CandidateRunnerNotConnectedError';
  }
}

export class CandidateActionTargetError extends Error {
  readonly code = 'action_target_not_allowed';

  constructor() {
    super('Ссылка действия должна вести на выбранную площадку по защищённому соединению.');
    this.name = 'CandidateActionTargetError';
  }
}

export class CandidateActionLimitError extends Error {
  readonly code = 'action_limit_reached';

  constructor(readonly reason: string) {
    super('Суточный лимит действий исчерпан или сейчас действуют тихие часы.');
    this.name = 'CandidateActionLimitError';
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

type PreparedCandidateAction = CandidateActionItem & { readonly id: string };

export type CandidateProviderStatus =
  | 'hh_response_submitted'
  | 'hh_resume_updated'
  | 'linkedin_application_submitted';

export interface RunnerOutcome {
  readonly status: 'delivered' | 'attempted' | 'failed';
  readonly failureCode?: string | null;
  readonly confirmationUrl?: string | null;
  readonly providerStatus?: CandidateProviderStatus | null;
}

/** A session is resolved only for the authenticated candidate and chosen platform. */
export interface CandidateActionSession {
  readonly candidateId: string;
  readonly platform: 'hh' | 'linkedin';
  readonly page: Page;
}

export interface CandidateActionSessionResolver {
  resolve(
    candidateId: string,
    platform: CandidateActionItem['platform'],
  ): Promise<CandidateActionSession | null> | CandidateActionSession | null;
}

export interface PlatformActionRunner {
  run(item: CandidateActionItem, session: CandidateActionSession): Promise<RunnerOutcome>;
}

/** Compatibility name for test fixtures that provide deterministic outcomes. */
export type CandidateActionResult = RunnerOutcome;

export class SimulatedCandidatePlatformRunner implements PlatformActionRunner {
  constructor(
    private readonly defaultOutcome: RunnerOutcome = { status: 'delivered' },
    private readonly outcomeOverrides?: Map<string, RunnerOutcome>,
  ) {}

  async run(action: CandidateActionItem, _session: CandidateActionSession): Promise<RunnerOutcome> {
    const outcome = this.outcomeOverrides?.get(action.id ?? '') ?? this.defaultOutcome;
    if (outcome.status !== 'delivered' || outcome.confirmationUrl || outcome.providerStatus) return outcome;
    return { ...outcome, providerStatus: confirmationStatusFor(action.actionKind) };
  }
}

export interface ExecuteBatchInput {
  readonly candidateId: string;
  readonly batchId?: string;
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
  readonly runner?: PlatformActionRunner;
  readonly sessionResolver?: CandidateActionSessionResolver;
  readonly consentStore?: SqliteCapabilityConsentStore;
  readonly applicationTracker?: CandidateApplicationTracker;
  readonly userTimezoneLookup?: (candidateId: string) => Promise<string | undefined> | string | undefined;
  readonly random?: () => number;
  readonly pause?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
}

interface PreparedBatch {
  readonly batchId: string;
  readonly actions: readonly PreparedCandidateAction[];
  readonly timezone: string;
  readonly initialNow: Date;
  readonly sessions: ReadonlyMap<CandidateActionItem['platform'], CandidateActionSession>;
}

const STOP_FAILURE_CODES = new Set([
  'challenge_required',
  'captcha_detected',
  'http_403',
  'unusual_surface',
  'login_required',
  'session_expired',
  'target_redirect_rejected',
  'candidate_session_mismatch',
]);

export class CandidateActionExecutor {
  private readonly repository: SqliteCandidateActionRepository;
  private readonly runner?: PlatformActionRunner;
  private readonly sessionResolver?: CandidateActionSessionResolver;
  private readonly consentStore?: SqliteCapabilityConsentStore;
  private readonly applicationTracker?: CandidateApplicationTracker;
  private readonly userTimezoneLookup?: CandidateActionExecutorOptions['userTimezoneLookup'];
  private readonly random: () => number;
  private readonly pause: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(options: CandidateActionExecutorOptions) {
    this.repository = options.repository;
    this.runner = options.runner;
    this.sessionResolver = options.sessionResolver;
    this.consentStore = options.consentStore;
    this.applicationTracker = options.applicationTracker;
    this.userTimezoneLookup = options.userTimezoneLookup;
    this.random = options.random ?? Math.random;
    this.pause = options.pause ?? pauseFor;
    this.now = options.now ?? (() => new Date());
  }

  async executeBatch(input: ExecuteBatchInput): Promise<ExecuteBatchResult> {
    const prepared = await this.prepareBatch(input);
    this.repository.createBatch(prepared.batchId, input.candidateId, prepared.initialNow.toISOString());
    this.repository.createPendingReceipts(
      prepared.batchId,
      input.candidateId,
      prepared.actions.map((action) => ({
        id: action.id!,
        platform: action.platform,
        actionKind: action.actionKind,
        applicationId: action.applicationId,
      })),
      prepared.initialNow.toISOString(),
    );
    const receipts = await this.runBatch(input, prepared);
    const status = calculateBatchStatus(receipts);
    this.repository.updateBatchStatus(prepared.batchId, status);
    return { batchId: prepared.batchId, status, receipts };
  }

  private async prepareBatch(input: ExecuteBatchInput): Promise<PreparedBatch> {
    assertConfirmation(input.confirmedByCandidate);
    this.assertConsent(input.candidateId);
    const actions: PreparedCandidateAction[] = input.actions.map((action) => ({
      ...action,
      id: isUuid(action.id) ? action.id : randomUUID(),
    }));
    validateBatch(actions);
    const runner = this.runner;
    const resolver = this.sessionResolver;
    if (!runner || !resolver) throw new CandidateRunnerNotConnectedError();

    const timezone = await this.resolveTimezone(input.candidateId, input.clientTimezone);
    const initialNow = this.resolveNow(input.nowIso);
    this.assertBatchCapacity({ ...input, actions }, timezone, initialNow);
    const sessions = await this.resolveSessions(input.candidateId, actions, resolver);
    return {
      batchId: isUuid(input.batchId) ? input.batchId : randomUUID(),
      actions,
      timezone,
      initialNow,
      sessions,
    };
  }

  private assertConsent(candidateId: string): void {
    const consent = this.consentStore?.getActiveConsent(candidateId, 'actions_on_behalf');
    if (!consent) throw new CandidateConsentRequiredError();
  }

  private assertBatchCapacity(input: ExecuteBatchInput, timezone: string, now: Date): void {
    const localDate = formatLocalDate(now, timezone);
    let usage = this.repository.getDailyUsage(input.candidateId, localDate);
    for (const action of input.actions) {
      const verdict = checkActionCapacity(action.actionKind, now, timezone, usage);
      if (!verdict.allowed) throw new CandidateActionLimitError(verdict.code ?? 'capacity_blocked');
      usage = usageAfterAction(usage, action.actionKind, now.toISOString());
    }
  }

  private async resolveSessions(
    candidateId: string,
    actions: readonly CandidateActionItem[],
    resolver: CandidateActionSessionResolver,
  ): Promise<ReadonlyMap<CandidateActionItem['platform'], CandidateActionSession>> {
    const sessions = new Map<CandidateActionItem['platform'], CandidateActionSession>();
    for (const platform of new Set(actions.map((action) => action.platform))) {
      const session = await resolver.resolve(candidateId, platform);
      if (!session) {
        throw new CandidateRunnerNotConnectedError(`Подключите свою сессию ${platform} в приложении для компьютера.`);
      }
      if (session.candidateId !== candidateId || session.platform !== platform) {
        throw new CandidateRunnerNotConnectedError('Сессия площадки не совпадает с аккаунтом кандидата.');
      }
      sessions.set(platform, session);
    }
    return sessions;
  }

  private async runBatch(
    input: ExecuteBatchInput,
    prepared: PreparedBatch,
  ): Promise<StoredActionReceipt[]> {
    const receipts: StoredActionReceipt[] = [];
    for (let index = 0; index < prepared.actions.length; index += 1) {
      if (index > 0) await this.pause(getCandidateActionPauseMs(this.random));
      const action = prepared.actions[index]!;
      if (this.repository.isKillSwitchActive(action.platform, input.candidateId)) {
        this.appendStoppedActions(input, prepared, index, receipts, 'kill_switch_active');
        break;
      }
      const receipt = await this.executeAction(action, input, prepared);
      receipts.push(receipt);
      if (receipt.status !== 'delivered') {
        this.appendStoppedActions(input, prepared, index + 1, receipts, 'batch_stopped');
        break;
      }
    }
    return receipts;
  }

  private async executeAction(
    action: PreparedCandidateAction,
    input: ExecuteBatchInput,
    prepared: PreparedBatch,
  ): Promise<StoredActionReceipt> {
    const now = this.resolveNow(input.nowIso);
    const localDate = formatLocalDate(now, prepared.timezone);
    const capacity = checkActionCapacity(
      action.actionKind,
      now,
      prepared.timezone,
      this.repository.getDailyUsage(input.candidateId, localDate),
    );
    if (!capacity.allowed) return this.recordFailed(action, input, prepared, capacity.code ?? 'capacity_blocked', now);

    // Reserve the daily slot synchronously before the first provider-side effect.
    this.repository.recordActionUsage(input.candidateId, localDate, action.actionKind, now.toISOString());
    const session = prepared.sessions.get(action.platform)!;
    let outcome: RunnerOutcome;
    try {
      outcome = await this.runner!.run(action, session);
    } catch {
      outcome = { status: 'failed', failureCode: 'runner_error' };
    }
    return this.recordOutcome(action, input, prepared, outcome, now);
  }

  private recordOutcome(
    action: PreparedCandidateAction,
    input: ExecuteBatchInput,
    prepared: PreparedBatch,
    outcome: RunnerOutcome,
    now: Date,
  ): StoredActionReceipt {
    const failureCode = safeFailureCode(outcome.failureCode);
    if (outcome.status === 'delivered') {
      if (!hasProviderConfirmation(action, outcome)) {
        return this.recordFailed(action, input, prepared, 'provider_confirmation_missing', now);
      }
      const receipt = this.repository.updateReceiptStatus({
        id: action.id,
        batchId: prepared.batchId,
        candidateId: input.candidateId,
        status: 'delivered',
        failureCode: null,
        executedAt: now.toISOString(),
      });
      this.advanceApplicationToApplied(input.candidateId, action.applicationId, now.toISOString());
      return receipt;
    }
    if (outcome.status === 'attempted' && !STOP_FAILURE_CODES.has(failureCode)) {
      return this.recordAttempted(action, input, prepared, failureCode, now);
    }
    return this.recordFailed(action, input, prepared, failureCode, now);
  }

  private recordAttempted(
    action: PreparedCandidateAction,
    input: ExecuteBatchInput,
    prepared: PreparedBatch,
    failureCode: string,
    now: Date,
  ): StoredActionReceipt {
    const receipt = this.repository.updateReceiptStatus({
      id: action.id,
      batchId: prepared.batchId,
      candidateId: input.candidateId,
      status: 'attempted',
      failureCode,
      executedAt: now.toISOString(),
    });
    this.recordApplicationAttemptNote(input.candidateId, action.applicationId, action.actionKind, failureCode, now.toISOString());
    return receipt;
  }

  private recordFailed(
    action: PreparedCandidateAction,
    input: ExecuteBatchInput,
    prepared: PreparedBatch,
    failureCode: string,
    now: Date,
  ): StoredActionReceipt {
    const safeCode = safeFailureCode(failureCode);
    const receipt = this.repository.updateReceiptStatus({
      id: action.id,
      batchId: prepared.batchId,
      candidateId: input.candidateId,
      status: 'failed',
      failureCode: safeCode,
      executedAt: now.toISOString(),
    });
    this.recordApplicationAttemptNote(input.candidateId, action.applicationId, action.actionKind, safeCode, now.toISOString());
    return receipt;
  }

  private appendStoppedActions(
    input: ExecuteBatchInput,
    prepared: PreparedBatch,
    startIndex: number,
    receipts: StoredActionReceipt[],
    reason: string,
  ): void {
    const now = this.resolveNow(input.nowIso);
    for (const action of prepared.actions.slice(startIndex)) {
      receipts.push(this.recordFailed(action, input, prepared, reason, now));
    }
  }

  private advanceApplicationToApplied(candidateId: string, applicationId: string | null | undefined, nowIso: string): void {
    if (!this.applicationTracker || !applicationId) return;
    try {
      const application = this.applicationTracker.getApplication(candidateId, applicationId);
      if (!application || application.stage !== 'saved') return;
      this.applicationTracker.patchApplication(candidateId, applicationId, {
        expectedVersion: application.version,
        stage: 'applied',
        occurredAt: nowIso,
      });
    } catch {
      // The provider receipt remains truthful; never roll a newer card version back.
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
        note: `Действие ${actionKind} не подтверждено: ${failureCode}`,
      });
    } catch {
      // Audit note failure does not change the provider outcome.
    }
  }

  private async resolveTimezone(candidateId: string, clientTimezone?: string): Promise<string> {
    if (this.userTimezoneLookup) {
      const found = await this.userTimezoneLookup(candidateId);
      if (found && isValidTimezone(found)) return found;
    }
    if (clientTimezone && isValidTimezone(clientTimezone)) return clientTimezone;
    return DEFAULT_ACCOUNT_TIMEZONE;
  }

  private resolveNow(nowIso?: string): Date {
    const parsed = nowIso ? new Date(nowIso) : this.now();
    return Number.isNaN(parsed.getTime()) ? this.now() : parsed;
  }
}

function assertConfirmation(confirmedByCandidate: boolean): void {
  if (!confirmedByCandidate) throw new CandidateConfirmationRequiredError();
}

function validateBatch(actions: readonly CandidateActionItem[]): void {
  if (actions.length < 1 || actions.length > MAX_CANDIDATE_ACTIONS_PER_BATCH) {
    throw new CandidateActionLimitError('batch_size_invalid');
  }
  for (const action of actions) {
    if (!isActionKindForPlatform(action.actionKind, action.platform)) throw new CandidateActionTargetError();
    if (!isAllowedCandidateActionTarget(action.platform, action.targetUrl)) throw new CandidateActionTargetError();
  }
}

function isActionKindForPlatform(kind: CandidateActionKind, platform: 'hh' | 'linkedin'): boolean {
  return platform === 'hh' ? kind !== 'linkedin_easy_apply' : kind === 'linkedin_easy_apply';
}

function usageAfterAction(
  usage: ReturnType<SqliteCandidateActionRepository['getDailyUsage']>,
  kind: CandidateActionKind,
  at: string,
): ReturnType<SqliteCandidateActionRepository['getDailyUsage']> {
  if (kind === 'hh_apply') return { ...usage, hhAppliesCount: usage.hhAppliesCount + 1 };
  if (kind === 'linkedin_easy_apply') {
    return { ...usage, linkedinEasyAppliesCount: usage.linkedinEasyAppliesCount + 1 };
  }
  return { ...usage, hhBoostsCount: usage.hhBoostsCount + 1, lastHhBoostAt: at };
}

function hasProviderConfirmation(action: CandidateActionItem, outcome: RunnerOutcome): boolean {
  if (
    outcome.confirmationUrl &&
    isAllowedCandidateActionTarget(action.platform, outcome.confirmationUrl) &&
    isDistinctConfirmationUrl(action.targetUrl, outcome.confirmationUrl)
  ) {
    return true;
  }
  return outcome.providerStatus === confirmationStatusFor(action.actionKind);
}

function isDistinctConfirmationUrl(targetUrl: string, confirmationUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const confirmation = new URL(confirmationUrl);
    return target.origin !== confirmation.origin || target.pathname !== confirmation.pathname;
  } catch {
    return false;
  }
}

function confirmationStatusFor(kind: CandidateActionKind): CandidateProviderStatus {
  if (kind === 'hh_apply') return 'hh_response_submitted';
  if (kind === 'hh_resume_boost') return 'hh_resume_updated';
  return 'linkedin_application_submitted';
}

function safeFailureCode(value?: string | null): string {
  return value && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : 'runner_failure';
}

function calculateBatchStatus(receipts: readonly StoredActionReceipt[]): ExecuteBatchResult['status'] {
  const delivered = receipts.filter((receipt) => receipt.status === 'delivered').length;
  if (delivered === receipts.length) return 'completed';
  return delivered > 0 ? 'partial_failure' : 'aborted';
}

function isUuid(value?: string): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value),
  );
}

async function pauseFor(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
