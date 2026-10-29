import type { RouteDeps } from './deps';
import { legacyVacancyFitProfileStamp, vacancyFitProfileStamp } from '../domain/vacancyFitProfileStamp';
import { readCampaign } from './campaignContext';
import { readTargetLevel } from './vacancyRoleContext';
import { evaluateLevelMatch } from '../vacancies/levelMatcher';
import { normalizeTitleKey } from '../vacancies/titleParse/normalizeTitleKey';
import { regionOfVacancy } from '../vacancies/vacancyGeography';
import { isResumeEvidenceEligible } from '../domain/resumeEvidenceEligibility';
import type { VacancyFitInput } from '../domain/vacancyFit';
import type { VacancyFitGate } from '../../shared/vacancyFit';
import type { VacancyRequirement } from '../domain/vacancyRequirements';

const gate = (status: VacancyFitGate['status'], reason: string): VacancyFitGate => ({ status, reason });

export function readVacancyFitTarget(deps: RouteDeps, vacancyId: string) {
  const sourceId = vacancyId.replace(/^cluster-/u, '');
  const cluster = deps.multiSourceEngine.getActiveCluster?.(vacancyId);
  const vacancy = deps.multiSourceEngine.getVacancy?.(sourceId);
  if (!cluster && !vacancy) return undefined;
  return {
    vacancyId, title: vacancy?.title ?? cluster!.canonicalTitle,
    description: vacancy?.fullDescription ?? vacancy?.description ?? cluster?.descriptionSummary ?? '',
    location: vacancy?.location ?? cluster?.canonicalLocation,
    country: undefined as string | undefined,
    isRemote: vacancy?.isRemote ?? cluster?.isRemote ?? false,
  };
}

/**
 * An explicit empty region list means «no region limit» (campaign-region-never-auto): it
 * confirms nothing and blocks nothing. Before 28.10 it blocked every vacancy with a known
 * region, so 520 of QA_CANDIDATE's 991 rows could never get a percent.
 */
export function regionGate(region: string | undefined, regions: { readonly value: readonly string[]; readonly origin: string }): VacancyFitGate {
  if (!region || regions.origin === 'default' || regions.value.length === 0) return gate('unknown', 'География не подтверждена.');
  return gate(regions.value.includes(region) ? 'matched' : 'blocked', 'Сверено с географией выбранной кампании.');
}

function roleGate(roles: readonly string[], title: string): VacancyFitGate {
  if (!roles.length) return gate('unknown', 'Целевая роль не подтверждена.');
  const normalized = title.toLocaleLowerCase();
  const exact = roles.some((role) => normalized === role.toLocaleLowerCase());
  // A shared word like “engineer” never certifies a different profession.
  return exact ? gate('matched', 'Название совпадает с выбранной целевой ролью.')
    : gate('unknown', 'Нужно подтвердить функцию и уровень этой роли.');
}

export function vacancyFitContext(
  deps: RouteDeps,
  candidateId: string,
  target: NonNullable<ReturnType<typeof readVacancyFitTarget>>,
  requirements: readonly VacancyRequirement[],
): VacancyFitInput {
  return createVacancyFitContextReader(deps, candidateId)(target, requirements);
}

export function createVacancyFitContextReader(deps: RouteDeps, candidateId: string) {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  const profileContextHash = vacancyFitProfileStamp(snapshot, workspace);
  const legacyProfileContextHash = legacyVacancyFitProfileStamp(snapshot, workspace);
  const facts = snapshot.memory.map((fact) => ({ ...fact, candidateId }));
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const targetLevel = readTargetLevel(deps.candidateStore, candidateId, campaign.roles.value);
  return (target: NonNullable<ReturnType<typeof readVacancyFitTarget>>, requirements: readonly VacancyRequirement[]): VacancyFitInput => {
  const level = evaluateLevelMatch(targetLevel, target.title, deps.titleParseStore.getByKey(normalizeTitleKey(target.title))?.levelRank);
  const region = regionOfVacancy({ location: target.location, country: target.country });
  const eligible = facts.filter(isResumeEvidenceEligible);
  const location = (target.country ?? target.location ?? '').toLocaleLowerCase();
  const authorization = location && eligible.find((fact) =>
    /право на работу|work authori[sz]ation|right to work/iu.test(fact.statement) &&
    fact.statement.toLocaleLowerCase().includes(location) &&
    ['имею право на работу в ', 'я имею право на работу в ', 'i have work authorization in ', 'i have the right to work in ']
      .some((prefix) => [prefix + location, prefix + location + '.'].includes(fact.statement.toLocaleLowerCase().trim())));
  return {
    candidateId, profileContextHash, legacyProfileContextHash, vacancyId: target.vacancyId, description: target.description, requirements, facts,
    gates: {
      role: roleGate(campaign.roles.value, target.title),
      level: level === 'match' ? gate('matched', 'Уровень совпадает с целевым.')
        : level === 'below' || level === 'above' ? gate('blocked', 'Уровень отличается от целевого.')
          : gate('unknown', 'Уровень роли или кандидата неизвестен.'),
      region: regionGate(region, campaign.regions),
      workFormat: campaign.remoteOnly
        ? gate(target.isRemote ? 'matched' : 'unknown', 'В кампании выбрана удалённая работа.')
        : gate('unknown', 'Допустимый формат работы нужно подтвердить.'),
      workAuthorization: authorization
        ? { status: 'matched', reason: 'Есть подтверждённый факт о праве на работу.', evidence: [{ factId: authorization.id, quote: authorization.statement }] }
        : gate('unknown', 'Право на работу для этой вакансии не подтверждено.'),
    },
  };
  };
}
