/**
 * B374 invitations remain behind a disabled-by-default flag. This step plans
 * and records synthetic-account invitations only; no live sender is wired here.
 */
import {
  planInvitations,
  selectInvitationTargets,
  type InvitationCandidate,
} from './invitationBudgetPolicy';
import { isLinkedinExecutorWithinHours, linkedinLocalDayStart } from './companyPageExecutorPolicy';
import {
  hashInvitationTarget,
  type PoolInvitationReservation,
  type SqlitePoolInvitationRepository,
} from '../data/sqlitePoolInvitationRepository';
import { pauseLinkedinPoolAccountForManualReview } from './executorAuditRepository';

export type InvitationSendOutcome = 'sent' | 'pending' | 'challenge' | 'restricted' | 'failed';

export type InvitationStepStatus =
  'disabled' | 'halted' | 'busy' | 'blocked' | 'no_target' | 'done';

export interface InvitationStepReport {
  readonly status: InvitationStepStatus;
  readonly sent: number;
  readonly reason?: string;
}

export interface InvitationStepTiming {
  readonly delayMinMs: number;
  readonly delayMaxMs: number;
  readonly failurePauseMs: number;
}

export interface InvitationStepDependencies {
  readonly enabled: boolean;
  readonly accountId: string;
  readonly timezone: string;
  readonly repository: SqlitePoolInvitationRepository;
  readonly hashKey?: Buffer;
  /** B395 emergency stop; account readiness is read from the repository. */
  readonly isHalted: () => boolean;
  readonly isBackingOff: () => boolean;
  readonly candidates: () => readonly InvitationCandidate[];
  readonly send: (profileUrl: string) => Promise<InvitationSendOutcome>;
  readonly onPlatformSignal: (outcome: 'challenge' | 'restricted') => void;
  readonly now: () => Date;
  readonly timing?: Partial<InvitationStepTiming>;
  readonly random?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export const DEFAULT_POOL_INVITATION_TIMING: InvitationStepTiming = {
  delayMinMs: 60_000,
  delayMaxMs: 180_000,
  failurePauseMs: 60 * 60_000,
};

const ACTIVE_ACCOUNTS = new Set<string>();

export function readPoolInvitationsEnabled(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.OPENQAREER_LINKEDIN_POOL_INVITATIONS_ENABLED?.trim().toLowerCase();
  if (!value || value === 'false') return false;
  if (value !== 'true') throw new Error('linkedin_pool_invitations_flag_invalid');
  return true;
}

export function readPoolInvitationHashKey(environment: NodeJS.ProcessEnv): Buffer | null {
  const value = environment.OPENQAREER_POOL_HASH_KEY?.trim();
  if (!value) return null;
  const key = Buffer.from(value, 'utf8');
  if (key.length < 32) throw new Error('linkedin_pool_hash_key_too_short');
  return key;
}

export function readPoolInvitationTiming(environment: NodeJS.ProcessEnv): InvitationStepTiming {
  const delayMinMs = readPositiveSeconds(
    environment,
    'OPENQAREER_POOL_INVITATION_DELAY_MIN_SECONDS',
    60,
  );
  const delayMaxMs = readPositiveSeconds(
    environment,
    'OPENQAREER_POOL_INVITATION_DELAY_MAX_SECONDS',
    180,
  );
  const failurePauseMs = readPositiveMinutes(
    environment,
    'OPENQAREER_POOL_INVITATION_FAILURE_PAUSE_MINUTES',
    60,
  );
  if (delayMaxMs < delayMinMs) throw new Error('linkedin_pool_invitation_delay_range_invalid');
  return { delayMinMs, delayMaxMs, failurePauseMs };
}

export async function runPoolInvitationStep(
  deps: InvitationStepDependencies,
): Promise<InvitationStepReport> {
  if (!deps.enabled) return { status: 'disabled', sent: 0 };
  if (ACTIVE_ACCOUNTS.has(deps.accountId)) return { status: 'busy', sent: 0 };
  if (!deps.hashKey) return { status: 'blocked', sent: 0, reason: 'hash_key_missing' };
  if (deps.hashKey.length < 32) return { status: 'blocked', sent: 0, reason: 'hash_key_invalid' };
  ACTIVE_ACCOUNTS.add(deps.accountId);
  try {
    return await runExclusiveInvitationStep(deps);
  } finally {
    ACTIVE_ACCOUNTS.delete(deps.accountId);
  }
}

async function runExclusiveInvitationStep(
  deps: InvitationStepDependencies,
): Promise<InvitationStepReport> {
  if (deps.isHalted()) return { status: 'halted', sent: 0 };
  if (deps.isBackingOff()) return { status: 'blocked', sent: 0, reason: 'backoff' };
  const now = deps.now();
  const account = deps.repository.resumeInvitationCooldown(deps.accountId, now);
  if (!account || account.state !== 'ready')
    return { status: 'halted', sent: 0, reason: 'account_paused' };
  const accountAgeDays = daysSince(account.createdAt, now);
  const state = {
    accountAgeDays,
    ...deps.repository.counters(deps.accountId, now, linkedinLocalDayStart(now, deps.timezone)),
    restricted: false,
    windowOpen: isLinkedinExecutorWithinHours(now, deps.timezone),
  };
  const plan = planInvitations(state);
  if (!plan.allowed) return { status: 'blocked', sent: 0, reason: plan.reason ?? 'blocked' };
  const targets = invitationTargets(deps, plan.allowed);
  return runInvitationTargets(deps, targets, state);
}

function invitationTargets(
  deps: InvitationStepDependencies,
  limit: number,
): readonly InvitationCandidate[] {
  const candidates = selectInvitationTargets(deps.candidates(), new Set(), limit * 8);
  const invited = deps.repository.invitedHashes(deps.accountId);
  return candidates
    .filter((target) => !invited.has(hashInvitationTarget(target.profileUrl, deps.hashKey!)))
    .slice(0, limit * 8);
}

async function runInvitationTargets(
  deps: InvitationStepDependencies,
  targets: readonly InvitationCandidate[],
  accountState: {
    readonly accountAgeDays: number;
    readonly restricted: boolean;
    readonly windowOpen: boolean;
  },
): Promise<InvitationStepReport> {
  let sent = 0;
  let skippedForCompany = false;
  for (let index = 0; index < targets.length; index += 1) {
    if (deps.isHalted()) return { status: 'halted', sent };
    if (deps.isBackingOff()) return { status: 'blocked', sent, reason: 'backoff' };
    const now = deps.now();
    const reservation = deps.repository.reserve(
      deps.accountId,
      targets[index]!.profileUrl,
      targets[index]!.company,
      targets[index]!.kind,
      deps.hashKey!,
      now,
      linkedinLocalDayStart(now, deps.timezone),
      accountState,
    );
    if (!reservation.id) {
      if (reservation.reason === 'company_cap' || reservation.reason === 'already_invited') {
        skippedForCompany ||= reservation.reason === 'company_cap';
        continue;
      }
      return { status: 'blocked', sent, reason: reservation.reason ?? 'blocked' };
    }
    if (sent > 0) {
      await waitBetweenInvitations(deps);
      if (deps.isHalted() || deps.isBackingOff()) {
        deps.repository.setStatus(reservation.id, 'failed', deps.now());
        return { status: 'halted', sent };
      }
    }
    const outcome = await attemptInvitation(deps, reservation, targets[index]!.profileUrl);
    if (outcome.status !== 'sent') return { ...outcome.report, sent };
    sent += 1;
  }
  if (sent > 0) return { status: 'done', sent };
  return skippedForCompany
    ? { status: 'blocked', sent: 0, reason: 'company_cap' }
    : { status: 'no_target', sent: 0 };
}

async function attemptInvitation(
  deps: InvitationStepDependencies,
  reservation: PoolInvitationReservation,
  profileUrl: string,
): Promise<{ status: 'sent' } | { status: 'stop'; report: InvitationStepReport }> {
  let outcome: InvitationSendOutcome;
  try {
    outcome = await deps.send(profileUrl);
  } catch {
    return pauseAfterFailure(deps, reservation.id!);
  }
  deps.repository.setStatus(reservation.id!, deliveredStatus(outcome), deps.now());
  if (outcome === 'challenge' || outcome === 'restricted') {
    const reason = outcome === 'challenge' ? 'challenge_required' : 'platform_restricted';
    pauseLinkedinPoolAccountForManualReview(
      deps.repository.getDatabase(),
      deps.accountId,
      reason,
      deps.now(),
    );
    deps.onPlatformSignal(outcome);
    return { status: 'stop', report: { status: 'halted', sent: 0, reason: outcome } };
  }
  if (outcome === 'failed') return pauseAfterFailure(deps, reservation.id!);
  return { status: 'sent' };
}

function pauseAfterFailure(
  deps: InvitationStepDependencies,
  invitationId: number,
): { status: 'stop'; report: InvitationStepReport } {
  const failedAt = deps.now();
  const timing = resolvedTiming(deps.timing);
  deps.repository.recordFailedAttemptAndPause(
    invitationId,
    deps.accountId,
    failedAt,
    timing.failurePauseMs,
  );
  return { status: 'stop', report: { status: 'halted', sent: 0, reason: 'send_failed' } };
}

async function waitBetweenInvitations(deps: InvitationStepDependencies): Promise<void> {
  const timing = resolvedTiming(deps.timing);
  const sample = boundedRandom(deps.random?.() ?? Math.random());
  const delay =
    timing.delayMinMs + Math.floor(sample * (timing.delayMaxMs - timing.delayMinMs + 1));
  await (deps.wait ?? defaultWait)(delay);
}

function deliveredStatus(outcome: InvitationSendOutcome): 'sent' | 'pending' | 'failed' {
  if (outcome === 'pending') return 'pending';
  if (outcome === 'sent') return 'sent';
  return 'failed';
}

function daysSince(createdAt: string, now: Date): number {
  return (now.getTime() - Date.parse(createdAt)) / 86_400_000;
}

function boundedRandom(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999999, Math.max(0, value));
}

function resolvedTiming(timing?: Partial<InvitationStepTiming>): InvitationStepTiming {
  const value = { ...DEFAULT_POOL_INVITATION_TIMING, ...timing };
  if (
    !Number.isFinite(value.delayMinMs) ||
    !Number.isFinite(value.delayMaxMs) ||
    !Number.isFinite(value.failurePauseMs) ||
    value.delayMinMs <= 0 ||
    value.delayMaxMs < value.delayMinMs ||
    value.failurePauseMs <= 0
  ) {
    throw new Error('linkedin_pool_invitation_timing_invalid');
  }
  return value;
}

function readPositiveSeconds(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  return readPositiveInteger(environment, name, fallback) * 1_000;
}

function readPositiveMinutes(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  return readPositiveInteger(environment, name, fallback) * 60_000;
}

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('linkedin_pool_invitation_timing_invalid');
  return value;
}

async function defaultWait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
