import type { ProposedRole } from '../../../shared/roleProposals';
import type { CareerRoleModel, MissingRoleRequirement, RoleNextAction, RoleStatus } from './careerScreenTypes';
import { calculateRoleWageFork, formatVacancyCount } from './careerWageFork';

function determineRoleStatus(proposed: ProposedRole): RoleStatus {
  if (proposed.confirmation.state === 'observed') {
    const { matchedRequirements, repeatedRequirements } = proposed.confirmation;
    if (repeatedRequirements.length > 0 && matchedRequirements >= repeatedRequirements.length) {
      return 'open_for_search';
    }
    if (matchedRequirements > 0) {
      return 'skills_checked';
    }
  }
  return 'hypothesis';
}

function determineNextAction(status: RoleStatus, vacancyCount: number): RoleNextAction {
  if (status === 'open_for_search') {
    return {
      label: 'Открыть вакансии',
      action: 'open_vacancies',
      href: '4-vakansii.html',
    };
  }
  if (vacancyCount >= 8) {
    return {
      label: 'Проверить навыки',
      action: 'check_skills',
      href: '11-proverka-navykov.html',
    };
  }
  if (vacancyCount > 0) {
    return {
      label: 'Дозаполнить',
      action: 'fill_with_consultant',
      href: '#',
    };
  }
  return {
    label: 'Мало данных',
    action: 'few_data',
    href: '#',
  };
}

export function mapProposedRoleToCareerRole(proposed: ProposedRole): CareerRoleModel {
  const status = determineRoleStatus(proposed);

  let vacancyCount = 0;
  let observedDate = '05.10';
  let confirmedItems: readonly string[] = [];
  let missingItems: readonly MissingRoleRequirement[] = [];

  if (proposed.confirmation.state === 'observed') {
    const conf = proposed.confirmation;
    vacancyCount = conf.sampleSize;
    if (conf.observedTo) {
      observedDate = conf.observedTo.slice(5).replace('-', '.');
    }
    const matchedCount = conf.matchedRequirements;
    const repeated = conf.repeatedRequirements ?? [];
    confirmedItems = repeated.slice(0, matchedCount);
    missingItems = repeated.slice(matchedCount).map((req) => ({
      text: req,
      isWarning: true,
    }));
  } else if (proposed.confirmation.state === 'too-few') {
    vacancyCount = proposed.confirmation.sampleSize;
  }

  const wageFork = calculateRoleWageFork({
    sampleSize: vacancyCount,
    minSalary: vacancyCount >= 8 ? 450_000 : undefined,
    maxSalary: vacancyCount >= 8 ? 650_000 : undefined,
  });

  const sampleNote = vacancyCount === 0 ? 'нет вакансий' : formatVacancyCount(vacancyCount);
  const nextAction = determineNextAction(status, vacancyCount);

  return {
    id: proposed.id,
    title: proposed.title,
    status,
    wageDisplay: wageFork.display,
    isWageCalculated: wageFork.isCalculated,
    vacancyCount,
    observedDate,
    sampleNote,
    confirmedItems,
    missingItems,
    nextAction,
    hypothesisReason: proposed.reason ?? 'Вывод из профиля и рынка.',
    rejected: false,
  };
}

export function mapProposedRolesToCareerRoles(
  roles: readonly ProposedRole[],
): readonly CareerRoleModel[] {
  return roles.map(mapProposedRoleToCareerRole);
}
