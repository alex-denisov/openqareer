import { pluralRu } from '../../../../shared/pluralRu';
import type { ProposedRole } from '../../../../shared/roleProposals';
import { mapProposedRoleToCareerRole } from '../../career-map/roleHypothesisAdapter';
import { formatVacancyCount } from '../../career-map/careerWageFork';
import type { CheckedRole } from '../../skills/roleSkillAssessmentApi';

/** Откуда роль в списке: выбрана для поиска, названа по опыту, добавлена кандидатом. */
export type RoleOrigin = 'search' | 'experience' | 'own';

export interface RoleCheck {
  readonly confirmed: number;
  readonly total: number;
}

/** Строка роли на вкладке «Роли» и столбец сравнения (s09, s10). */
export interface RoleRow {
  readonly id: string;
  readonly title: string;
  /** «380–520 тыс. ₽»; `null` — зарплат в выборке мало или нет. */
  readonly wage: string | null;
  /** «hh.ru, 96 вакансий, 10.11» или «нет данных о зарплатах». */
  readonly wageNote: string;
  /** Вакансий роли в подборке; `null` — не найдено. */
  readonly vacancies: number | null;
  readonly origin: RoleOrigin;
  /** Что из частых требований роли подтверждает опыт. */
  readonly confirms: string | null;
  /** Чего не хватает; `null` — пробелов нет. */
  readonly lacks: string | null;
  /** Итог проверки навыков; `null` — проверка не пройдена. */
  readonly check: RoleCheck | null;
  /** Все частые требования роли: по ним ищется промежуточная роль (S11). */
  readonly requirements: readonly string[];
}

const NO_WAGE = 'нет данных о зарплатах';
const LIST_LIMIT = 2;

const key = (title: string): string => title.trim().toLocaleLowerCase('ru');

function namesOf(role: ProposedRole): readonly string[] {
  return [role.title, ...(role.aliases ?? [])].map(key);
}

function wageSample(role: ProposedRole): number {
  const conf = role.confirmation;
  return conf.state === 'observed' ? (conf.wage?.sampleSize ?? 0) : 0;
}

function listOf(items: readonly { readonly text: string }[]): string | null {
  return items.length === 0
    ? null
    : items
        .slice(0, LIST_LIMIT)
        .map((item) => item.text)
        .join(', ');
}

function originOf(role: ProposedRole, search: ReadonlySet<string>): RoleOrigin {
  if (namesOf(role).some((name) => search.has(name))) return 'search';
  return role.origin === 'candidate' ? 'own' : 'experience';
}

function rowOf(
  role: ProposedRole,
  search: ReadonlySet<string>,
  checked: readonly CheckedRole[],
): RoleRow {
  const model = mapProposedRoleToCareerRole(role, {
    acceptedTitle: null,
    offersDismissed: [],
    checkedTitles: checked.map((entry) => entry.roleTitle),
    checkedSkills: Object.fromEntries(
      checked.map((entry) => [entry.roleTitle, entry.confirmedSkills ?? []]),
    ),
  });
  const sample = wageSample(role);
  const wageNote = model.isWageCalculated
    ? [model.sources.join(', '), formatVacancyCount(sample), model.observedDate]
        .filter(Boolean)
        .join(', ')
    : NO_WAGE;
  return {
    id: role.id,
    title: role.title,
    wage: model.isWageCalculated ? model.wageDisplay : null,
    wageNote,
    vacancies: model.vacancyCount > 0 ? model.vacancyCount : null,
    origin: originOf(role, search),
    confirms: listOf(model.confirmedItems),
    lacks: listOf(model.missingItems),
    requirements: [...model.confirmedItems, ...model.missingItems].map((item) => item.text),
    check:
      model.status === 'hypothesis'
        ? null
        : {
            confirmed: model.confirmedItems.length,
            total: model.confirmedItems.length + model.missingItems.length,
          },
  };
}

function searchOnlyRow(title: string): RoleRow {
  return {
    id: `search:${key(title)}`,
    title,
    wage: null,
    wageNote: NO_WAGE,
    vacancies: null,
    origin: 'search',
    confirms: null,
    lacks: null,
    check: null,
    requirements: [],
  };
}

/** Роли по профилю и роли поиска одним списком: больше вакансий — выше, без вакансий — внизу. */
export function buildRoleRows(
  roles: readonly ProposedRole[],
  searchTitles: readonly string[],
  checked: readonly CheckedRole[],
): readonly RoleRow[] {
  const search = new Set(searchTitles.map(key));
  const rows = roles.map((role) => rowOf(role, search, checked));
  const known = new Set(roles.flatMap(namesOf));
  const extra = searchTitles.filter((title) => !known.has(key(title))).map(searchOnlyRow);
  return [...rows, ...extra].sort((a, b) => (b.vacancies ?? -1) - (a.vacancies ?? -1));
}

export interface SearchStrip {
  readonly title: string;
  readonly count: string | null;
}

/** Полоса «Роль поиска»: первая роль, «и ещё N», число вакансий по ним. */
export function searchStrip(
  rows: readonly RoleRow[],
  searchTitles: readonly string[],
): SearchStrip | null {
  const [first] = searchTitles;
  if (!first) return null;
  const more = searchTitles.length - 1;
  const total = rows
    .filter((row) => row.origin === 'search')
    .reduce((sum, row) => sum + (row.vacancies ?? 0), 0);
  return {
    title: more > 0 ? `${first} и ещё ${more}` : first,
    count: total > 0 ? `${formatVacancyCount(total)} · по подборке за 30 дней` : null,
  };
}

export function skillStripText(count: number): string {
  return `Проверьте ${pluralRu(count, ['навык', 'навыка', 'навыков'])} — точнее подбор`;
}

export function compareCheckTag(row: RoleRow): { readonly text: string; readonly ok: boolean } {
  if (!row.check) return { text: 'не начата', ok: false };
  const share = row.check.total > 0 ? ` · ${row.check.confirmed} из ${row.check.total}` : '';
  return { text: `пройдена${share}`, ok: true };
}

export const ORIGIN_LABEL: Readonly<Record<RoleOrigin, string>> = {
  search: 'роль поиска',
  experience: 'по вашему опыту',
  own: 'вы добавили',
};
