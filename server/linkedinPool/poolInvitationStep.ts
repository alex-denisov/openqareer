/**
 * B374 срез 3: шаг приглашений пула. За флагом, по умолчанию выключен: при
 * выключенном флаге не вызывается ничего (ни база, ни отправка). Реальной
 * отправки здесь нет — её передаёт вызывающий код через `send`.
 */
import {
  planInvitations,
  selectInvitationTargets,
  type InvitationCandidate,
} from './invitationBudgetPolicy';
import { isLinkedinExecutorWithinHours, linkedinLocalDayStart } from './companyPageExecutorPolicy';
import type { SqlitePoolInvitationRepository } from '../data/sqlitePoolInvitationRepository';
import { hashInvitationTarget } from '../data/sqlitePoolInvitationRepository';

export type InvitationSendOutcome = 'sent' | 'pending' | 'challenge' | 'restricted' | 'failed';

export type InvitationStepStatus = 'disabled' | 'halted' | 'blocked' | 'no_target' | 'done';

export interface InvitationStepReport {
  readonly status: InvitationStepStatus;
  readonly sent: number;
  readonly reason?: string;
}

export interface InvitationStepDependencies {
  readonly enabled: boolean;
  readonly accountId: string;
  readonly timezone: string;
  readonly repository: SqlitePoolInvitationRepository;
  /** Сработала остановка B395 / пауза исполнителя / аккаунт не `ready`. */
  readonly isHalted: () => boolean;
  readonly accountAgeDays: () => number;
  readonly candidates: () => readonly InvitationCandidate[];
  /** Приглашение без сопроводительного текста. */
  readonly send: (profileUrl: string) => Promise<InvitationSendOutcome>;
  readonly onPlatformSignal: (outcome: 'challenge' | 'restricted') => void;
  readonly now: () => Date;
}

export function readPoolInvitationsEnabled(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.OPENQAREER_LINKEDIN_POOL_INVITATIONS_ENABLED?.trim().toLowerCase();
  if (!value || value === 'false') return false;
  if (value !== 'true') throw new Error('linkedin_pool_invitations_flag_invalid');
  return true;
}

export async function runPoolInvitationStep(
  deps: InvitationStepDependencies,
): Promise<InvitationStepReport> {
  if (!deps.enabled) return { status: 'disabled', sent: 0 };
  if (deps.isHalted()) return { status: 'halted', sent: 0 };
  const now = deps.now();
  const plan = planInvitations({
    accountAgeDays: deps.accountAgeDays(),
    ...deps.repository.counters(deps.accountId, now, linkedinLocalDayStart(now, deps.timezone)),
    restricted: false,
    windowOpen: isLinkedinExecutorWithinHours(now, deps.timezone),
  });
  if (plan.allowed === 0) return { status: 'blocked', sent: 0, reason: plan.reason ?? 'blocked' };

  const invited = deps.repository.invitedHashes(deps.accountId);
  const targets = selectInvitationTargets(deps.candidates(), new Set(), plan.allowed * 2).filter(
    (target) => !invited.has(hashInvitationTarget(target.profileUrl)),
  );
  let sent = 0;
  for (const target of targets.slice(0, plan.allowed)) {
    if (deps.isHalted()) return { status: 'halted', sent };
    const id = deps.repository.plan(deps.accountId, target.profileUrl, target.company, target.kind, deps.now());
    if (id === null) continue;
    const outcome = await deps.send(target.profileUrl);
    const status = outcome === 'pending' ? 'pending' : outcome === 'sent' ? 'sent' : 'failed';
    deps.repository.setStatus(id, status, deps.now());
    if (outcome === 'challenge' || outcome === 'restricted') {
      deps.onPlatformSignal(outcome);
      return { status: 'halted', sent, reason: outcome };
    }
    if (outcome === 'failed') return { status: 'done', sent, reason: 'send_failed' };
    sent += 1;
  }
  return { status: sent === 0 ? 'no_target' : 'done', sent };
}
