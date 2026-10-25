import type { ProposedRole } from '../../../shared/roleProposals';
import { apiFetch, malformedResponseError, throwApiError } from '../coach/apiClient';
import {
  chooseCareerStrategyRole,
  getCareerStrategy,
  rejectCoachProposal,
} from '../coach/coachApi';
import type { RolesSample } from './roleHypothesisAdapter';
import { getCheckedRoles } from '../skills/roleSkillAssessmentApi';

/** Ключи решений по ролям в хранилище отклонённых предложений консультанта. */
export const roleRejectionKey = (roleId: string): string => `career-role:${roleId}`;
export const roleOfferDismissKey = (roleId: string): string => `career-role-offer:${roleId}`;

export interface RoleDecisionsRead {
  readonly rejected: readonly string[];
  readonly offersDismissed: readonly string[];
}

export interface RoleHypothesesWithDecisions {
  readonly roles: readonly ProposedRole[];
  readonly decisions: RoleDecisionsRead;
  readonly acceptedTitle: string | null;
  readonly checkedTitles: readonly string[];
  /** B565: подтверждённые проверкой навыки по названию роли. */
  readonly checkedSkills: Readonly<Record<string, readonly string[]>>;
  readonly sample: RolesSample | null;
}

function readSample(meta: unknown): RolesSample | null {
  const value = (meta as { sample?: Partial<RolesSample> } | undefined)?.sample;
  if (!value) return null;
  return {
    observedAt: typeof value.observedAt === 'string' ? value.observedAt : null,
    sources: Array.isArray(value.sources) ? value.sources : [],
  };
}

function readDecisions(meta: unknown): RoleDecisionsRead {
  const value = (meta as { roleDecisions?: Partial<RoleDecisionsRead> } | undefined)?.roleDecisions;
  return {
    rejected: Array.isArray(value?.rejected) ? value.rejected : [],
    offersDismissed: Array.isArray(value?.offersDismissed) ? value.offersDismissed : [],
  };
}

/**
 * Роли, решения кандидата по ним и выбранная роль «Стратегии» — одним чтением.
 * Стратегия не прочиталась — это не «роль не выбрана», поэтому ошибка не глушится.
 */
export async function readRoleHypothesesWithDecisions(
  signal?: AbortSignal,
): Promise<RoleHypothesesWithDecisions> {
  const [response, strategy, checked] = await Promise.all([
    apiFetch('/api/v1/candidate/role-hypotheses', { signal }),
    getCareerStrategy(signal),
    getCheckedRoles(signal),
  ]);
  if (!response.ok) await throwApiError(response);
  const envelope = (await response.json()) as { data?: unknown; meta?: unknown };
  if (!Array.isArray(envelope.data)) throw malformedResponseError();
  return {
    roles: envelope.data as ProposedRole[],
    decisions: readDecisions(envelope.meta),
    acceptedTitle: strategy?.current.role.title ?? null,
    checkedTitles: checked.map((role) => role.roleTitle),
    checkedSkills: Object.fromEntries(
      checked.map((role) => [role.roleTitle, role.confirmedSkills ?? []]),
    ),
    sample: readSample(envelope.meta),
  };
}

async function saveDecision(proposalKey: string, reason: string): Promise<void> {
  const result = await rejectCoachProposal({ proposalKey, reason });
  if (!result.ok || result.proposalKey !== proposalKey) {
    throw new Error('Сервер не подтвердил решение. Попробуйте ещё раз.');
  }
}

export function rejectCareerRole(roleId: string): Promise<void> {
  return saveDecision(roleRejectionKey(roleId), 'Роль отклонена на экране «Карьера»');
}

export function dismissCareerRoleOffer(roleId: string): Promise<void> {
  return saveDecision(roleOfferDismissKey(roleId), 'Предложение открыть роль отложено');
}

/** «Принять роль» — выбор роли в «Стратегии»: по ней пересчитывается подборка. */
export async function acceptCareerRole(title: string): Promise<string> {
  const strategy = await chooseCareerStrategyRole({
    title,
    reason: 'Роль принята по предложению консультанта на экране «Карьера»',
  });
  return strategy.current.role.title;
}
