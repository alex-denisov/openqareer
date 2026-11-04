import type { FastifyRequest } from 'fastify';
import type { ProposedRole } from '../../shared/roleProposals';
import { readCampaign } from './campaignContext';
import { masterResumeDocument, withResumeCoverage } from './careerRoleResumeCoverage';
import { careerRolesWithCandidateChoices } from './careerRoleSync';
import type { RouteDeps } from './deps';
import { conditionsMarketCount, finishMatchedVacancies } from './matchedVacancyRoutes';
import { readRoleContext, type RoleContext } from './vacancyRoleContext';

export interface CareerRolesRead {
  readonly context: RoleContext;
  readonly roles: ProposedRole[];
  readonly conditionsCount: ReturnType<typeof conditionsMarketCount>;
}

/**
 * Роли «Карьеры» так, как их отдаёт GET /role-hypotheses: роли по профилю и
 * пулу плюс выбранные кандидатом. Без подтверждённого профиля — null.
 */
export async function readCareerRoleContext(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
): Promise<CareerRolesRead | null> {
  const context = await readRoleContext(deps, request, candidateId);
  if (!context) return null;
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const targetRoles = [...campaign.roles.value];
  const listed = finishMatchedVacancies(
    context.matched,
    targetRoles,
    campaign,
    deps.candidateStore,
    candidateId,
  );
  return {
    context,
    roles: withResumeCoverage(
      careerRolesWithCandidateChoices(deps, candidateId, context, listed),
      masterResumeDocument(deps, candidateId),
    ),
    conditionsCount: conditionsMarketCount(context.matched, listed, targetRoles, campaign),
  };
}

/** Только список ролей — для чтений, которым не нужен разбор пула (ATS «Профиля»). */
export async function readCareerRoles(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
): Promise<ProposedRole[] | null> {
  return (await readCareerRoleContext(deps, request, candidateId))?.roles ?? null;
}
