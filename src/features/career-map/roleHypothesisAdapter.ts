import type { ProposedRole } from '../../../shared/roleProposals';
import type {
  CareerRoleModel,
  ConfirmedRoleItem,
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
  /** Роли с завершённой проверкой навыков (B445). */
  readonly checkedTitles?: readonly string[];
  /** B565: навыки, подтверждённые проверкой, по названию роли. */
  readonly checkedSkills?: Readonly<Record<string, readonly string[]>>;
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

/** Одна роль под любым из своих названий: сервер сводит их по функции и уровню. */
function namesRole(proposed: ProposedRole, title: string): boolean {
  return [proposed.title, ...(proposed.aliases ?? [])].some((name) => sameTitle(name, title));
}

function isAccepted(proposed: ProposedRole, decisions: RoleDecisions): boolean {
  return Boolean(decisions.acceptedTitle && namesRole(proposed, decisions.acceptedTitle));
}

function isChecked(proposed: ProposedRole, decisions: RoleDecisions): boolean {
  return decisions.checkedTitles?.some((title) => namesRole(proposed, title)) ?? false;
}

function determineRoleStatus(proposed: ProposedRole, decisions: RoleDecisions): RoleStatus {
  if (isAccepted(proposed, decisions)) return 'open_for_search';
  if (isChecked(proposed, decisions)) return 'skills_checked';
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
  readonly confirmedItems: readonly ConfirmedRoleItem[];
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
      confirmedItems: conf.repeatedRequirements
        .filter((req) => matched.has(req))
        .map((text) => ({ text, source: 'profile' as const })),
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

/** Проверка пройдена под любым названием роли: модель могла переименовать её позже (29.10). */
function skillsConfirmedByCheck(
  proposed: ProposedRole,
  decisions: RoleDecisions,
): readonly string[] {
  const entry = Object.entries(decisions.checkedSkills ?? {}).find(([checked]) =>
    namesRole(proposed, checked),
  );
  return entry?.[1] ?? [];
}

/** Итог проверки навыков дополняет сверку с профилем: подтверждённое не числится недостающим. */
function withCheckedSkills(evidence: RoleEvidence, checked: readonly string[]): RoleEvidence {
  if (checked.length === 0) return evidence;
  const key = (text: string) => text.trim().toLocaleLowerCase('ru');
  const fromCheck = new Set(checked.map(key));
  return {
    ...evidence,
    confirmedItems: [
      ...checked.map((text) => ({ text, source: 'check' as const })),
      ...evidence.confirmedItems.filter((item) => !fromCheck.has(key(item.text))),
    ],
    missingItems: evidence.missingItems.filter((item) => !fromCheck.has(key(item.text))),
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

function withoutPeriod(text: string): string {
  return text.trim().replace(/[.…]+$/u, '');
}

/** Чем обоснована гипотеза: доводом консультанта или выборкой рынка (28.10). */
function hypothesisNoteOf(proposed: ProposedRole, vacancyCount: number): string | undefined {
  if (proposed.origin === 'market' && vacancyCount > 0) {
    // Причина рыночной роли — совпавшие навыки кандидата (28.10), не довод консультанта.
    const basis = proposed.reason?.trim() ? `; ${withoutPeriod(proposed.reason)}` : '';
    return `Гипотеза по рынку: ${formatVacancyCount(vacancyCount)} с этим названием в функциях вашего опыта${basis}. Подходит ли она вам, пока не проверено.`;
  }
  if (proposed.reason?.trim()) {
    return `Гипотеза консультанта: ${withoutPeriod(proposed.reason)}. Это вывод из профиля, пока не проверенный.`;
  }
  return undefined;
}

export function mapProposedRoleToCareerRole(
  proposed: ProposedRole,
  decisions: RoleDecisions,
): CareerRoleModel {
  const status = determineRoleStatus(proposed, decisions);
  const evidence = withCheckedSkills(
    readEvidence(proposed),
    skillsConfirmedByCheck(proposed, decisions),
  );
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
        ? // Подборка уже идёт по роли (26.10): проверка подтверждает навыки, а не открывает поиск.
          'Роль перейдёт в «Навыки проверены», а подтверждённые навыки войдут в сопоставление с вакансиями.'
        : undefined,
    nextAction: determineNextAction(status, evidence.vacancyCount),
    hypothesisNote: hypothesisNoteOf(proposed, evidence.vacancyCount),
    offerDismissed: decisions.offersDismissed.includes(proposed.id),
    alreadyChosen:
      proposed.origin === 'candidate' ||
      isAccepted(proposed, decisions) ||
      isChecked(proposed, decisions),
  };
}

export function mapProposedRolesToCareerRoles(
  roles: readonly ProposedRole[],
  decisions: RoleDecisions,
): readonly CareerRoleModel[] {
  const mapped = roles.map((role) => mapProposedRoleToCareerRole(role, decisions));
  // Роль без вакансий не стоит среди ролей рынка (28.10): она внизу, с честной подписью.
  return [
    ...mapped.filter((role) => role.vacancyCount > 0),
    ...mapped.filter((role) => role.vacancyCount === 0),
  ];
}

/** Дата и площадки выборки, из которой сервер назвал роли (B445). */
export interface RolesSample {
  readonly observedAt: string | null;
  readonly sources: readonly string[];
}

export function summarizeRolesMarket(
  roles: readonly CareerRoleModel[],
  sample?: RolesSample | null,
): RolesMarketSummary {
  const latest = [...roles.map((role) => role.observedAt), sample?.observedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return {
    vacancyTotal: roles.reduce((sum, role) => sum + role.vacancyCount, 0),
    asOf: dayMonth(latest),
    sources: [
      ...new Set([
        ...roles.flatMap((role) => role.sources),
        ...(sample?.sources ?? []).map(sourceLabel),
      ]),
    ],
  };
}
