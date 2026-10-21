import type { ProposedRole } from '../../../shared/roleProposals';
import type {
  CareerRoleModel,
  MissingRoleRequirement,
  RoleNextAction,
  RoleStatus,
  RolesMarketSummary,
} from './careerScreenTypes';
import { vacancySourceLabel } from '../../../shared/vacancySourceLabel';
import { calculateRoleWageFork, formatVacancyCount, MIN_WAGE_SAMPLE } from './careerWageFork';

/** Решения кандидата, которые меняют статус роли (B445). */
export interface RoleDecisions {
  /** Роль, выбранная в «Стратегии»: по ней пересчитывается подборка. */
  readonly acceptedTitle: string | null;
  readonly offersDismissed: readonly string[];
}

/** Коды, которых нет в общей подписи источников: подвал не должен показывать сырой код. */
const EXTRA_SOURCE_LABELS: Readonly<Record<string, string>> = {
  hh_search: 'hh.ru',
  linkedin: 'LinkedIn',
  career_site: 'сайты компаний',
  habr: 'Хабр Карьера',
  indeed: 'Indeed',
  workday: 'Workday',
};

const SKILLS_SECTION = 'Профиль, Навыки';

function sourceLabel(source: string): string {
  return EXTRA_SOURCE_LABELS[source] ?? vacancySourceLabel({ sourceType: source });
}

function dayMonth(iso: string | undefined): string | null {
  if (!iso) return null;
  const [, month, day] = iso.slice(0, 10).split('-');
  return month && day ? `${day}.${month}` : null;
}

function sameTitle(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('ru') === right.trim().toLocaleLowerCase('ru');
}

function determineRoleStatus(proposed: ProposedRole, decisions: RoleDecisions): RoleStatus {
  if (decisions.acceptedTitle && sameTitle(decisions.acceptedTitle, proposed.title)) {
    return 'open_for_search';
  }
  const conf = proposed.confirmation;
  return conf.state === 'observed' && conf.matchedRequirements > 0
    ? 'skills_checked'
    : 'hypothesis';
}

function determineNextAction(status: RoleStatus, vacancyCount: number): RoleNextAction {
  if (status === 'open_for_search') return { label: 'Открыть вакансии', action: 'open_vacancies' };
  if (vacancyCount < MIN_WAGE_SAMPLE) return { label: 'Мало данных', action: 'few_data' };
  if (status === 'skills_checked') return { label: 'Дозаполнить', action: 'fill_with_consultant' };
  return { label: 'Проверить навыки', action: 'check_skills' };
}

interface RoleEvidence {
  readonly vacancyCount: number;
  readonly observedAt: string | null;
  readonly sources: readonly string[];
  readonly confirmedItems: readonly string[];
  readonly missingItems: readonly MissingRoleRequirement[];
  readonly requirementsNote: string;
}

function readEvidence(proposed: ProposedRole): RoleEvidence {
  const conf = proposed.confirmation;
  if (conf.state === 'observed') {
    const matched = new Set(conf.matchedRequirementNames ?? []);
    const date = dayMonth(conf.observedTo);
    return {
      vacancyCount: conf.sampleSize,
      observedAt: conf.observedTo || null,
      sources: [...new Set(conf.sources.map((entry) => sourceLabel(entry.source)))],
      confirmedItems: conf.repeatedRequirements.filter((req) => matched.has(req)),
      missingItems: conf.repeatedRequirements
        .filter((req) => !matched.has(req))
        .map((req) => ({ text: req, isWarning: true, linkSection: SKILLS_SECTION })),
      requirementsNote: `Сверка с требованиями ${formatVacancyCount(conf.sampleSize)}${date ? `, ${date}` : ''}.`,
    };
  }
  const count = conf.state === 'too-few' ? conf.sampleSize : 0;
  return {
    vacancyCount: count,
    observedAt: null,
    sources: [],
    confirmedItems: [],
    missingItems: [],
    requirementsNote:
      count > 0
        ? `Требования не сверены: найдено только ${formatVacancyCount(count)}, нужно от ${MIN_WAGE_SAMPLE}.`
        : 'Требования не сверены: вакансий роли пока не найдено.',
  };
}

function wageOf(proposed: ProposedRole, vacancyCount: number) {
  const conf = proposed.confirmation;
  const wage = conf.state === 'observed' ? conf.wage : undefined;
  const fork = calculateRoleWageFork({
    sampleSize: wage?.sampleSize ?? 0,
    minSalary: wage?.min,
    maxSalary: wage?.max,
  });
  const note =
    fork.isCalculated && wage && wage.sampleSize < vacancyCount
      ? `вилка по ${wage.sampleSize} ${wage.sampleSize % 10 === 1 && wage.sampleSize % 100 !== 11 ? 'вакансии' : 'вакансиям'} с зарплатой`
      : null;
  return { fork, note };
}

export function mapProposedRoleToCareerRole(
  proposed: ProposedRole,
  decisions: RoleDecisions,
): CareerRoleModel {
  const status = determineRoleStatus(proposed, decisions);
  const evidence = readEvidence(proposed);
  const { fork, note } = wageOf(proposed, evidence.vacancyCount);

  return {
    id: proposed.id,
    title: proposed.title,
    status,
    wageDisplay: fork.display,
    isWageCalculated: fork.isCalculated,
    wageSampleNote: note,
    vacancyCount: evidence.vacancyCount,
    observedDate: dayMonth(evidence.observedAt ?? undefined),
    observedAt: evidence.observedAt,
    sources: evidence.sources,
    confirmedItems: evidence.confirmedItems,
    missingItems: evidence.missingItems,
    requirementsNote: evidence.requirementsNote,
    skillCheckBenefit:
      status === 'hypothesis'
        ? 'Роль перейдёт в «Навыки проверены», и её можно будет открыть для поиска.'
        : undefined,
    nextAction: determineNextAction(status, evidence.vacancyCount),
    hypothesisReason: proposed.reason ?? undefined,
    offerDismissed: decisions.offersDismissed.includes(proposed.id),
  };
}

export function mapProposedRolesToCareerRoles(
  roles: readonly ProposedRole[],
  decisions: RoleDecisions,
): readonly CareerRoleModel[] {
  return roles.map((role) => mapProposedRoleToCareerRole(role, decisions));
}

export function summarizeRolesMarket(roles: readonly CareerRoleModel[]): RolesMarketSummary {
  const latest = roles
    .map((role) => role.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return {
    vacancyTotal: roles.reduce((sum, role) => sum + role.vacancyCount, 0),
    asOf: dayMonth(latest),
    sources: [...new Set(roles.flatMap((role) => role.sources))],
  };
}
