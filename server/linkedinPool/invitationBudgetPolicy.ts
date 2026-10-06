/**
 * Бюджет приглашений в контакты для аккаунтов пула (B374).
 * Чистая политика: сам клик по LinkedIn здесь не выполняется, исполнитель
 * обязан спросить `planInvitations` перед каждым приглашением.
 * Лимит платформы ≈ 100 приглашений в скользящие 7 дней (мягкий, по поведению);
 * пул держится заметно ниже, а при плохом принятии останавливается сам.
 */

export const INVITATION_LIMITS = {
  platformWeekly: 100,
  matureWeekly: 35,
  matureDaily: 7,
  freshWeekly: 14,
  freshDaily: 3,
  freshAgeDays: 90,
  pendingMax: 80,
  acceptanceSampleMin: 20,
  acceptanceFloor: 0.2,
  perCompany: 3,
} as const;

export type InvitationStopReason =
  | 'account_restricted'
  | 'outside_window'
  | 'weekly_cap'
  | 'daily_cap'
  | 'too_many_pending'
  | 'low_acceptance';

export interface InvitationAccountState {
  readonly accountAgeDays: number;
  readonly sentLast7d: number;
  readonly sentToday: number;
  readonly sentLast30d: number;
  readonly acceptedLast30d: number;
  readonly pending: number;
  readonly restricted: boolean;
  readonly windowOpen: boolean;
}

export interface InvitationPlan {
  readonly allowed: number;
  readonly reason: InvitationStopReason | null;
}

const stop = (reason: InvitationStopReason): InvitationPlan => ({ allowed: 0, reason });

export function planInvitations(state: InvitationAccountState): InvitationPlan {
  const fresh = state.accountAgeDays < INVITATION_LIMITS.freshAgeDays;
  const weekly = fresh ? INVITATION_LIMITS.freshWeekly : INVITATION_LIMITS.matureWeekly;
  const daily = fresh ? INVITATION_LIMITS.freshDaily : INVITATION_LIMITS.matureDaily;

  if (state.restricted) return stop('account_restricted');
  if (!state.windowOpen) return stop('outside_window');
  if (state.pending >= INVITATION_LIMITS.pendingMax) return stop('too_many_pending');
  if (
    state.sentLast30d >= INVITATION_LIMITS.acceptanceSampleMin &&
    state.acceptedLast30d / state.sentLast30d < INVITATION_LIMITS.acceptanceFloor
  ) {
    return stop('low_acceptance');
  }
  if (state.sentLast7d >= weekly) return stop('weekly_cap');
  if (state.sentToday >= daily) return stop('daily_cap');
  return { allowed: Math.min(daily - state.sentToday, weekly - state.sentLast7d), reason: null };
}

export interface InvitationCandidate {
  readonly profileUrl: string;
  readonly company: string;
  /** recruiter — рекрутёр или HR-лидер целевой компании; hub — открытый узел с большой сетью. */
  readonly kind: 'recruiter' | 'hub';
}

const PROFILE_URL = /^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+\/?$/u;

export function selectInvitationTargets(
  candidates: readonly InvitationCandidate[],
  alreadyInvited: ReadonlySet<string>,
  limit: number,
): readonly InvitationCandidate[] {
  const ordered = [...candidates]
    .filter((c) => PROFILE_URL.test(c.profileUrl.replace('://www.', '://')) && !alreadyInvited.has(c.profileUrl))
    .sort((a, b) => Number(b.kind === 'recruiter') - Number(a.kind === 'recruiter'));
  const perCompany = new Map<string, number>();
  const picked: InvitationCandidate[] = [];
  for (const c of ordered) {
    if (picked.length >= limit) break;
    const taken = perCompany.get(c.company) ?? 0;
    if (taken >= INVITATION_LIMITS.perCompany) continue;
    perCompany.set(c.company, taken + 1);
    picked.push(c);
  }
  return picked;
}
