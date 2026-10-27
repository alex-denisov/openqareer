import { careerRoleId, type ProposedRole } from '../../shared/roleProposals';
import { roleWorkFamily } from '../../shared/roleWorkFamilies';
import type { CareerRoleRef } from '../vacancies/campaign';
import { careerRoleKey } from '../vacancies/careerRoleKey';
import { searchTermsForRoles } from '../vacancies/vacancyDemandTerms';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { confirmChosenTitle } from '../vacancies/roleHypotheses';
import { rejectedCareerRoleIds } from './campaignContext';
import type { RouteDeps } from './deps';
import type { RoleContext } from './vacancyRoleContext';

/**
 * Больше ролей подбор не держит (схема кампании). Роли, подтверждённые опытом,
 * идут первыми и не срезаются ради ролей рынка (26.10).
 */
const MAX_CAREER_ROLES = 20;

/** Ключ одной роли: функция и уровень, а без словаря — id по названию. */
function sameRoleKey(title: string): string {
  return careerRoleKey(title) ?? careerRoleId(title);
}

/**
 * Роли «Карьеры» = роли, названные по профилю и разговору, плюс роли,
 * выбранные самим кандидатом (мастер, принятое предложение консультанта),
 * которых среди названных нет (решение владельца 26.10).
 */
export function careerRolesWithCandidateChoices(
  deps: Pick<RouteDeps, 'candidateStore'>,
  candidateId: string,
  context: RoleContext,
  /**
   * Список «Вакансий» после географии «Карьеры», формата и решений кандидата:
   * роль мастера считается по нему, как фильтр «Роли» (26.10). Без него — пул.
   */
  listed: readonly MatchedVacancyItem[] = context.matched,
): ProposedRole[] {
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  const known = new Set(context.proposals.map((role) => role.id));
  const chosenKeys = new Set<string>();
  const chosen = (workspace?.campaign?.roles ?? []).flatMap<ProposedRole>((title) => {
    const id = careerRoleId(title);
    if (known.has(id)) return [];
    known.add(id);
    chosenKeys.add(sameRoleKey(title));
    return [
      {
        id,
        title,
        origin: 'candidate',
        reason: null,
        evidenceRefs: [],
        confirmation: confirmChosenTitle({
          matched: listed,
          title,
          candidateSkills: context.confirmedSkills,
        }),
        family: roleWorkFamily(title),
      },
    ];
  });
  // Роль мастера и та же роль под другим названием — одна строка: остаётся
  // название кандидата, вакансии считаются по функции и уровню.
  return [
    ...chosen,
    ...context.proposals.filter((role) => !chosenKeys.has(sameRoleKey(role.title))),
  ];
}

/**
 * Запоминает роли, которые кандидат видит на «Карьере», чтобы подбор
 * «Вакансий» шёл по ним же: что на экране, то и в подборе. Роли рынка тоже
 * идут в подбор — на проде модель называния часто молчит, и все пять ролей
 * «Карьеры» приходят из пула (26.10). Подбор идёт по функции и уровню роли, а
 * не по её названию, поэтому сам себя он не раскачивает. Пишет при изменении.
 */
export function persistCareerRoles(
  deps: Pick<RouteDeps, 'candidateStore'> &
    Partial<Pick<RouteDeps, 'matchedPoolPrecompute' | 'vacancyDemand'>>,
  candidateId: string,
  roles: readonly ProposedRole[],
): boolean {
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!workspace) return false;
  // Каждая роль на экране — запрос к площадкам, даже если вакансий по ней ещё
  // нет: сбор подстраивается под кандидата, а не наоборот (27.10).
  deps.vacancyDemand?.record(
    searchTermsForRoles([...(workspace.campaign?.roles ?? []), ...roles.map((role) => role.title)]),
    Date.now(),
  );
  // Как и пересборка ролей: без выбора кандидата его поля остаются пустыми.
  const campaign = workspace.campaign ?? {
    roles: [],
    regions: [],
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
  const rejected = rejectedCareerRoleIds(deps.candidateStore, candidateId);
  const wizard = new Set([...campaign.roles.map(careerRoleId), ...campaign.roles.map(sameRoleKey)]);
  const next: CareerRoleRef[] = roles
    .filter(
      (role) =>
        role.origin !== 'candidate' &&
        !rejected.has(role.id) &&
        !wizard.has(role.id) &&
        !wizard.has(sameRoleKey(role.title)),
    )
    .sort((left, right) => Number(left.origin !== 'model') - Number(right.origin !== 'model'))
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
