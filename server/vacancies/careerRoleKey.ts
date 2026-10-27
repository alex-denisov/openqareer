import { titleMatchesRole } from '../../shared/vacancyRoleTitleMatch';
import { rulesParse } from './titleParse/rulesParse';

/**
 * Одна роль под разными названиями (26.10): «Технический директор» и
 * «Технический директор (CTO)», «Chief Operating Officer» и «Операционный
 * директор» — одна функция и уровень. Ключ даёт словарь ролей (онтология
 * подбора); название, которого словарь не знает, сводится только по строке.
 *
 * Руководитель функции — одна роль, как бы его ни звали (решение владельца
 * 27.10): CIO, IT Director и директор по IT; VP of Customer Support и Customer
 * Support Director. Уровень от руководителя направления до C-level один, потому
 * что рынок называет их по-разному. Специалисты сводятся только по роли
 * словаря: «AI Solutions Architect» — не «Software Engineer».
 */
const keys = new Map<string, string | null>();
const MAX_CACHED_KEYS = 50_000;

/** От руководителя направления (head, director) и выше. */
const LEADERSHIP_RANK = 2;

/**
 * Функции, внутри которых руководители разных смыслов: Chief of Staff — не
 * генеральный директор. Их роли сводятся только по словарю.
 */
const UNMERGED_FUNCTIONS: ReadonlySet<string> = new Set(['exec-general', 'other']);

function keyOf(title: string): string | null {
  const parsed = rulesParse(title);
  const primary = parsed.roleId?.split('.')[0] ?? parsed.functions[0];
  const leads = parsed.levelRank !== null && parsed.levelRank >= LEADERSHIP_RANK;
  if (primary && leads && !UNMERGED_FUNCTIONS.has(primary)) return `${primary}:lead`;
  return parsed.roleId ?? null;
}

export function careerRoleKey(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const known = keys.get(trimmed);
  if (known !== undefined) return known;
  const key = keyOf(trimmed);
  if (keys.size >= MAX_CACHED_KEYS) keys.clear();
  keys.set(trimmed, key);
  return key;
}

/**
 * Относится ли вакансия к роли кандидата: прежнее совпадение по словам или
 * та же функция и уровень. Им считают «Мои роли на рынке» и фильтр «Роли».
 */
export function sameCareerRole(vacancyTitle: string, role: string): boolean {
  if (titleMatchesRole(vacancyTitle, role)) return true;
  const roleKey = careerRoleKey(role);
  return roleKey !== null && careerRoleKey(vacancyTitle) === roleKey;
}

/** Функции, к которым словарь относит название; общий код `other` не в счёт. */
export function careerRoleFunctions(title: string): string[] {
  return rulesParse(title.trim()).functions.filter((code) => code !== 'other');
}
