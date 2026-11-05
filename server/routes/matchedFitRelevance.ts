import { vacancyFitPercent, vacancyFitStage, vacancyFitTier } from '../../shared/vacancyFitPercent';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { careerRoleRowKey } from '../vacancies/careerRoleKey';
import { gradeRangeOfTitle, type GradeRange } from '../vacancies/titleParse/gradeRange';
import { rulesParse } from '../vacancies/titleParse/rulesParse';

/**
 * Порядок «по совпадению» сверху вниз (владелец 05.11). Процент сравнивает только требования и не
 * видит роль: 100 % у «Руководителя отдела эксплуатации» и 91 % у CTO для кандидата на CTO.
 * Цвет процента главный и никогда не нарушается; внутри одного цвета сначала роль кандидата,
 * затем вакансии минимум с 5 требованиями, затем сам процент. Новых баллов нет, процент тот же.
 */
export type ExactRoleTest = (title: string) => boolean;

/** 3 из 3 ниже 10 из 10: у 127 из 726 посчитанных строк adenisov.test требований не больше четырёх. */
export const RELIABLE_REQUIREMENTS = 5;

/** Первое лицо функции и выше: для них решение 27.10 считает разные названия одной ролью. */
const TOP_ROLE_KEY = /:(?:top|chief)$/u;

/** Без `titleKey`: он выбрасывает «главный» и «senior», а уровень здесь часть роли. */
function plainWords(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

function roleOfTitle(title: string): string | undefined {
  return rulesParse(title).roleId;
}

/** Junior и Senior в словаре одна роль; слово грейда их разводит, название без него не сужает. */
function gradesMeet(role: GradeRange | null, title: GradeRange | null): boolean {
  return !role || !title || (role.min <= title.max && title.min <= role.max);
}

/**
 * Название той же ступени считается той же ролью, если ступень первого лица или роль кандидата есть
 * в словаре: «Руководитель службы поддержки» для Head of Customer Support. Роль вне словаря (Head of
 * IT Service Management) не расширяется: иначе в неё попадает «Руководитель отдела эксплуатации».
 */
function roleKeyOf(role: string): string | null {
  const key = careerRoleRowKey(role);
  if (key === null) return null;
  if (TOP_ROLE_KEY.test(key)) return key;
  return key.endsWith(':head') && roleOfTitle(role) ? key : null;
}

/**
 * Та же роль: одна запись словаря и подходящий грейд, название дословно содержит роль либо один ключ роли.
 * `sameCareerRole` здесь не годится: он сводит всех «руководителей» функции и считает любые два
 * общих слова («Head of Support» и «Head of AI»).
 */
export function exactRoleTest(targetRoles: readonly string[]): ExactRoleTest {
  const rolesById = new Map<string, (GradeRange | null)[]>();
  for (const role of targetRoles) {
    const roleId = roleOfTitle(role);
    if (roleId) rolesById.set(roleId, [...(rolesById.get(roleId) ?? []), gradeRangeOfTitle(role)]);
  }
  const words = targetRoles.map(plainWords).filter((role) => role.trim() !== '');
  const roleKeys = new Set(targetRoles.map(roleKeyOf).filter((key) => key !== null));
  const known = new Map<string, boolean>();
  const decide = (title: string): boolean => {
    const roleId = roleOfTitle(title);
    const grades = roleId ? rolesById.get(roleId) : undefined;
    if (grades?.some((grade) => gradesMeet(grade, gradeRangeOfTitle(title)))) return true;
    const plain = plainWords(title);
    if (words.some((role) => plain.includes(role))) return true;
    const rowKey = careerRoleRowKey(title);
    return rowKey !== null && roleKeys.has(rowKey);
  };
  return (title) => {
    const stored = known.get(title);
    if (stored !== undefined) return stored;
    const answer = decide(title);
    known.set(title, answer);
    return answer;
  };
}

const TIER_RANK = { hi: 0, good: 1, mid: 2, low: 3 } as const;
const NO_PERCENT_TIER = 4;
const STAGE_RANK = { counted: 0, counted_low: 0, counting: 1, none: 2 } as const;

interface RankedRow {
  readonly title: string;
  readonly view: VacancyFitView | undefined;
}

function relevanceKey({ title, view }: RankedRow, isExact: ExactRoleTest): readonly number[] {
  const percent = vacancyFitPercent(view);
  const thin = percent !== null && (view?.result?.coverage?.total ?? 0) < RELIABLE_REQUIREMENTS;
  return [
    Number((view?.result?.conditionBlocks?.length ?? 0) > 0),
    STAGE_RANK[vacancyFitStage(view)],
    percent === null ? NO_PERCENT_TIER : TIER_RANK[vacancyFitTier(percent)],
    isExact(title) ? 0 : 1,
    Number(thin),
    -(percent ?? 0),
  ];
}

/** Убывающий порядок по совпадению; строки с равным ключом решает вызывающий. */
export function compareFitRelevance(
  left: RankedRow,
  right: RankedRow,
  isExact: ExactRoleTest,
): number {
  const leftKey = relevanceKey(left, isExact);
  const rightKey = relevanceKey(right, isExact);
  const at = leftKey.findIndex((part, index) => part !== rightKey[index]);
  return at === -1 ? 0 : leftKey[at]! - rightKey[at]!;
}
