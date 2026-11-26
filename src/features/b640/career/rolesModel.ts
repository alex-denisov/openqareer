import { pluralRu } from '../../../../shared/pluralRu';
import type { ProposedRole } from '../../../../shared/roleProposals';
import { mapProposedRoleToCareerRole } from '../../career-map/roleHypothesisAdapter';
import { formatVacancyCount } from '../../career-map/careerWageFork';
import type { CheckedRole } from '../../skills/roleSkillAssessmentApi';
import { roleLabel, type RoleTitlesRu } from './roleLabel';

/** Откуда роль в списке: выбрана для поиска, названа по опыту, добавлена кандидатом. */
export type RoleOrigin = 'search' | 'experience' | 'own';

export interface RoleCheck {
  readonly confirmed: number;
  readonly total: number;
  /** B764: проверка пройдена под другим названием роли — какой и куда ведёт ссылка. */
  readonly source?: { readonly title: string; readonly label: string };
}

/** Строка роли на вкладке «Роли» и столбец сравнения (s09, s10). */
export interface RoleRow {
  readonly id: string;
  /** Ключ роли поиска и проверки (английское название онтологии). */
  readonly title: string;
  /** B737: название для кандидата — русское, если оно есть. */
  readonly label: string;
  /** «380–520 тыс. ₽»; `null` — зарплат в выборке мало или нет. */
  readonly wage: string | null;
  /** «hh.ru, 96 вакансий, 10.11» или «нет данных о зарплатах». */
  readonly wageNote: string;
  /** Вакансий роли в подборке; `null` — не найдено. */
  readonly vacancies: number | null;
  readonly origin: RoleOrigin;
  /** Что из частых требований роли подтверждает опыт. */
  readonly confirms: string | null;
  /** B747: все подтверждённые навыки целиком — в «Чего не хватает» их быть не может. */
  readonly confirmedNames: readonly string[];
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

/** B645-2 (s09, макет «hh.ru, 96 вакансий»): главный источник и «и ещё N», а не все площадки. */
export function sourcesLine(sources: readonly string[]): string {
  const [first, ...rest] = sources;
  if (!first) return '';
  return rest.length > 0 ? `${first} и ещё ${rest.length}` : first;
}

function originOf(role: ProposedRole, search: ReadonlySet<string>): RoleOrigin {
  if (namesOf(role).some((name) => search.has(name))) return 'search';
  return role.origin === 'candidate' ? 'own' : 'experience';
}

function rowOf(
  role: ProposedRole,
  search: ReadonlySet<string>,
  checked: readonly CheckedRole[],
  titlesRu: RoleTitlesRu,
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
  const label = role.titleRu || roleLabel(role.title, titlesRu);
  const wageNote = model.isWageCalculated
    ? [sourcesLine(model.sources), formatVacancyCount(sample), model.observedDate]
        .filter(Boolean)
        .join(', ')
    : NO_WAGE;
  return {
    id: role.id,
    title: role.title,
    label,
    wage: model.isWageCalculated ? model.wageDisplay : null,
    wageNote,
    vacancies: model.vacancyCount > 0 ? model.vacancyCount : null,
    origin: originOf(role, search),
    confirms: listOf(model.confirmedItems),
    confirmedNames: model.confirmedItems.map((item) => item.text),
    lacks: listOf(model.missingItems),
    requirements: [...model.confirmedItems, ...model.missingItems].map((item) => item.text),
    check:
      model.status === 'hypothesis'
        ? null
        : (runCheck(role, label, checked) ?? {
            confirmed: model.confirmedItems.length,
            total: model.confirmedItems.length + model.missingItems.length,
          }),
  };
}

/**
 * B764: проверка «Chief Operating Officer» засчитана и строке «VP of Operations» — у обеих
 * это название среди псевдонимов. Такая строка честно называет роль проверки и её счёт.
 * B645 (прод c6dac4fe): строка, чьё название совпадает с ролью проверки, считала по модели роли
 * («6 из 6» рядом с «3 из 5» той же проверки). Если прогон знает число навыков — счёт прогона.
 */
function runCheck(
  role: ProposedRole,
  label: string,
  checked: readonly CheckedRole[],
): RoleCheck | null {
  const names = namesOf(role);
  const entry =
    checked.find((item) => key(item.roleTitle) === key(role.title)) ??
    checked.find((item) => names.includes(key(item.roleTitle)));
  if (!entry || entry.skillCount === undefined) return null;
  const confirmed = entry.confirmedSkills?.length ?? 0;
  const counts = { confirmed, total: entry.skillCount };
  const sourceLabel = entry.roleTitleRu ?? entry.roleTitle;
  const ownRun = key(entry.roleTitle) === key(role.title) || key(sourceLabel) === key(label);
  return ownRun ? counts : { ...counts, source: { title: entry.roleTitle, label: sourceLabel } };
}

function searchOnlyRow(title: string, titlesRu: RoleTitlesRu): RoleRow {
  return {
    id: `search:${key(title)}`,
    title,
    label: roleLabel(title, titlesRu),
    wage: null,
    wageNote: NO_WAGE,
    vacancies: null,
    origin: 'search',
    confirms: null,
    confirmedNames: [],
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
  titlesRu: RoleTitlesRu = {},
): readonly RoleRow[] {
  const search = new Set(searchTitles.map(key));
  const rows = roles.map((role) => rowOf(role, search, checked, titlesRu));
  const known = new Set(roles.flatMap(namesOf));
  const extra = searchTitles
    .filter((title) => !known.has(key(title)))
    .map((title) => searchOnlyRow(title, titlesRu));
  return [...rows, ...extra].sort((a, b) => (b.vacancies ?? -1) - (a.vacancies ?? -1));
}

export interface SearchStrip {
  readonly title: string;
  readonly count: string | null;
}

/** Полоса «Роль поиска»: первая роль, «и ещё N», число вакансий выбора — то же, что в списке. */
export function searchStrip(
  titles: readonly string[],
  total: number | null,
  titlesRu: RoleTitlesRu = {},
): SearchStrip | null {
  const [key0] = titles;
  if (!key0) return null;
  const first = roleLabel(key0, titlesRu);
  const more = titles.length - 1;
  return {
    title: more > 0 ? `${first} и ещё ${more}` : first,
    count:
      total !== null && total > 0
        ? `${formatVacancyCount(total)} · по подборке за 30 дней`
        : null,
  };
}

export function skillStripText(count: number): string {
  return `Проверьте ${pluralRu(count, ['навык', 'навыка', 'навыков'])} — точнее подбор`;
}

export function compareCheckTag(row: RoleRow): { readonly text: string; readonly ok: boolean } {
  // B645-2 (решение оркестратора 23.11): столбец роли показывает проверку только этой роли;
  // пройденная под другим названием (B764) здесь «не начата».
  if (!row.check || row.check.source) return { text: 'не начата', ok: false };
  const share = row.check.total > 0 ? ` · ${row.check.confirmed} из ${row.check.total}` : '';
  return { text: `пройдена${share}`, ok: true };
}

export const ORIGIN_LABEL: Readonly<Record<RoleOrigin, string>> = {
  search: 'роль поиска',
  experience: 'по вашему опыту',
  own: 'вы добавили',
};
