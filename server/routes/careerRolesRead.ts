import type { FastifyRequest } from 'fastify';
import type { ProposedRole } from '../../shared/roleProposals';
import { readCampaign } from './campaignContext';
import { masterResumeDocument, withResumeCoverage } from './careerRoleResumeCoverage';
import { countRolesLikeTheList } from './careerRoleCounts';
import { careerRolesWithCandidateChoices } from './careerRoleSync';
import type { RouteDeps } from './deps';
import { conditionsMarketCount, finishMatchedVacancies } from './matchedVacancyRoutes';
import { readRoleContext, readTargetLevel, type RoleContext } from './vacancyRoleContext';
import { campaignLevelWindow } from '../vacancies/titleParse/candidateRoleFunctions';
import { dropOutsideLevelGate } from '../vacancies/storedVacancyLevels';

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
  // B726: число роли — строки, которые откроет «Вакансии по роли»: список «Подборки» после
  // ворот уровня, тот же признак роли, за 30 дней подписи «по подборке за 30 дней».
  const targetLevel = readTargetLevel(deps.candidateStore, candidateId, targetRoles);
  const shown = dropOutsideLevelGate(
    listed,
    campaignLevelWindow(targetRoles, targetLevel),
    targetLevel,
    (key) => deps.titleParseStore.getByKey(key),
  );
  const roles = countRolesLikeTheList(
    careerRolesWithCandidateChoices(deps, candidateId, context, listed),
    shown,
    { skills: context.confirmedSkills, now: new Date() },
  );
  return {
    context,
    roles: withResumeCoverage(roles, masterResumeDocument(deps, candidateId)),
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
