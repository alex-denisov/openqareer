import { careerRoleId, type ProposedRole } from '../../shared/roleProposals';
import { roleWorkFamily } from '../../shared/roleWorkFamilies';
import type { CareerRoleRef } from '../vacancies/campaign';
import { confirmChosenTitle } from '../vacancies/roleHypotheses';
import { rejectedCareerRoleIds } from './campaignContext';
import type { RouteDeps } from './deps';
import type { RoleContext } from './vacancyRoleContext';

/** Больше ролей подбор не держит: схема кампании ограничена десятью. */
const MAX_CAREER_ROLES = 10;

/**
 * Роли «Карьеры» = роли, названные по профилю и разговору, плюс роли,
 * выбранные самим кандидатом (мастер, принятое предложение консультанта),
 * которых среди названных нет (решение владельца 26.10).
 */
export function careerRolesWithCandidateChoices(
  deps: Pick<RouteDeps, 'candidateStore'>,
  candidateId: string,
  context: RoleContext,
): ProposedRole[] {
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  const known = new Set(context.proposals.map((role) => role.id));
  const chosen = (workspace?.campaign?.roles ?? []).flatMap<ProposedRole>((title) => {
    const id = careerRoleId(title);
    if (known.has(id)) return [];
    known.add(id);
    return [
      {
        id,
        title,
        origin: 'candidate',
        reason: null,
        evidenceRefs: [],
        confirmation: confirmChosenTitle({
          matched: context.matched,
          title,
          candidateSkills: context.confirmedSkills,
        }),
        family: roleWorkFamily(title),
      },
    ];
  });
  return [...chosen, ...context.proposals];
}

/**
 * Запоминает роли, которые кандидат видит на «Карьере», чтобы подбор
 * «Вакансий» шёл по ним же: что на экране, то и в подборе. Роли рынка тоже
 * идут в подбор — на проде модель называния часто молчит, и все пять ролей
 * «Карьеры» приходят из пула (26.10). Подбор идёт по функции и уровню роли, а
 * не по её названию, поэтому сам себя он не раскачивает. Пишет при изменении.
 */
export function persistCareerRoles(
  deps: Pick<RouteDeps, 'candidateStore'> & Partial<Pick<RouteDeps, 'matchedPoolPrecompute'>>,
  candidateId: string,
  roles: readonly ProposedRole[],
): boolean {
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!workspace) return false;
  // Как и пересборка ролей: без выбора кандидата его поля остаются пустыми.
  const campaign = workspace.campaign ?? {
    roles: [],
    regions: [],
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
  const rejected = rejectedCareerRoleIds(deps.candidateStore, candidateId);
  const wizard = new Set(campaign.roles.map(careerRoleId));
  const next: CareerRoleRef[] = roles
    .filter((role) => role.origin !== 'candidate' && !rejected.has(role.id) && !wizard.has(role.id))
    .slice(0, MAX_CAREER_ROLES)
    .map((role) => ({ id: role.id, title: role.title }));
  const previous = campaign.careerRoles ?? [];
  if (sameRoles(previous, next)) return false;
  deps.candidateStore.saveCandidateWorkspace(candidateId, {
    ...workspace,
    campaign: { ...campaign, careerRoles: next },
  });
  deps.matchedPoolPrecompute?.prioritizeCampaign(candidateId);
  return true;
}

function sameRoles(a: readonly CareerRoleRef[], b: readonly CareerRoleRef[]): boolean {
  return a.length === b.length && a.every((role, index) => role.id === b[index]?.id);
}
