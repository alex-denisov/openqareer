import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { FastifyRequest } from 'fastify';
import type { ProposedRole } from '../../shared/roleProposals';
import { readCampaign } from './campaignContext';
import { masterResumeDocument, withResumeCoverage } from './careerRoleResumeCoverage';
import { careerTimeZone, countRolesLikeTheList } from './careerRoleCounts';
import { careerRolesWithCandidateChoices, withStoredTitlesRu } from './careerRoleSync';
import type { RouteDeps } from './deps';
import { conditionsMarketCount, finishMatchedVacanciesYielding } from './matchedVacancyRoutes';
import { readRoleContext, readTargetLevel, type RoleContext } from './vacancyRoleContext';
import { levelGateSteps } from './matchedVacancyList';
import { runStepsYielding } from '../vacancies/yieldingSteps';

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
  const listed = await finishMatchedVacanciesYielding(
    context.matched,
    targetRoles,
    campaign,
    deps.candidateStore,
    candidateId,
  );
  // B726: число роли — строки, которые откроет «Вакансии по роли»: список «Подборки» после
  // ворот уровня, тот же признак роли, за 30 дней подписи «по подборке за 30 дней».
  const targetLevel = readTargetLevel(deps.candidateStore, candidateId, targetRoles);
  const shown = await runStepsYielding(
    levelGateSteps(listed, targetRoles, targetLevel, deps.titleParseStore),
    { section: 'career-roles:level' },
  );
  // B702-2: каждая часть — своим ходом event loop (прод 24.11: 1300 мс одним куском).
  await yieldToEventLoop();
  const chosen = careerRolesWithCandidateChoices(deps, candidateId, context, listed);
  await yieldToEventLoop();
  const roles = countRolesLikeTheList(
    chosen,
    shown,
    {
      skills: context.confirmedSkills,
      now: new Date(),
      // Граница дня — как у «Сегодня»: пояс кандидата из `?tz=`, без него UTC.
      timeZone: careerTimeZone(request.query),
    },
  );
  return {
    context,
    // B748: перевод, сохранённый прежним называнием, не теряется при новом.
    roles: withStoredTitlesRu(
      deps.candidateStore.getCandidateWorkspace(candidateId)?.campaign,
      withResumeCoverage(roles, masterResumeDocument(deps, candidateId)),
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
