import { describe, expect, it } from 'vitest';
import {
  INVITATION_LIMITS,
  planInvitations,
  selectInvitationTargets,
  type InvitationAccountState,
  type InvitationCandidate,
} from './invitationBudgetPolicy';

const base: InvitationAccountState = {
  accountAgeDays: 400,
  sentLast7d: 0,
  sentToday: 0,
  sentLast30d: 0,
  acceptedLast30d: 0,
  pending: 0,
  restricted: false,
  windowOpen: true,
};

describe('planInvitations', () => {
  it('зрелый аккаунт получает дневной потолок, ниже лимита платформы', () => {
    const plan = planInvitations(base);
    expect(plan.allowed).toBe(INVITATION_LIMITS.matureDaily);
    expect(INVITATION_LIMITS.matureWeekly).toBeLessThan(INVITATION_LIMITS.platformWeekly);
  });

  it('новый аккаунт разгоняется медленнее зрелого', () => {
    const fresh = planInvitations({ ...base, accountAgeDays: 10 });
    expect(fresh.allowed).toBeLessThan(planInvitations(base).allowed);
  });

  it('недельный остаток ограничивает дневной бюджет', () => {
    const plan = planInvitations({ ...base, sentLast7d: INVITATION_LIMITS.matureWeekly - 2 });
    expect(plan.allowed).toBe(2);
  });

  it.each([
    ['restricted', { restricted: true }, 'account_restricted'],
    ['вне окна', { windowOpen: false }, 'outside_window'],
    ['недельный потолок', { sentLast7d: INVITATION_LIMITS.matureWeekly }, 'weekly_cap'],
    ['дневной потолок', { sentToday: INVITATION_LIMITS.matureDaily }, 'daily_cap'],
    ['много ожидающих', { pending: INVITATION_LIMITS.pendingMax }, 'too_many_pending'],
    ['низкое принятие', { sentLast30d: 40, acceptedLast30d: 4 }, 'low_acceptance'],
  ] as const)('останавливается: %s', (_name, patch, reason) => {
    const plan = planInvitations({ ...base, ...patch });
    expect(plan.allowed).toBe(0);
    expect(plan.reason).toBe(reason);
  });

  it('низкое принятие не блокирует, пока выборка мала', () => {
    expect(planInvitations({ ...base, sentLast30d: 5, acceptedLast30d: 0 }).allowed).toBeGreaterThan(0);
  });
});

const person = (id: string, over: Partial<InvitationCandidate> = {}): InvitationCandidate => ({
  profileUrl: `https://www.linkedin.com/in/${id}`,
  company: 'Acme',
  kind: 'recruiter',
  ...over,
});

describe('selectInvitationTargets', () => {
  it('рекрутёры идут раньше узлов, повторные приглашения исключены', () => {
    const picked = selectInvitationTargets(
      [person('hub', { kind: 'hub' }), person('rec'), person('seen')],
      new Set(['https://www.linkedin.com/in/seen']),
      5,
    );
    expect(picked.map((p) => p.profileUrl)).toEqual([
      'https://www.linkedin.com/in/rec',
      'https://www.linkedin.com/in/hub',
    ]);
  });

  it('не больше трёх приглашений на компанию и не больше запрошенного числа', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id));
    expect(selectInvitationTargets(many, new Set(), 10)).toHaveLength(INVITATION_LIMITS.perCompany);
    expect(selectInvitationTargets(many, new Set(), 2)).toHaveLength(2);
  });

  it('отбрасывает чужие домены и адреса не профилей', () => {
    const picked = selectInvitationTargets(
      [person('x', { profileUrl: 'https://evil.example/in/x' }), person('y', { profileUrl: 'https://www.linkedin.com/jobs/1' })],
      new Set(),
      5,
    );
    expect(picked).toEqual([]);
  });
});
