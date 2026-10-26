import { titleMatchesRole } from '../../shared/vacancyRoleTitleMatch';
import { rulesParse } from './titleParse/rulesParse';

/**
 * Одна роль под разными названиями (26.10): «Технический директор» и
 * «Технический директор (CTO)», «Chief Operating Officer» и «Операционный
 * директор» — одна функция и уровень. Ключ даёт словарь ролей (онтология
 * подбора); название, которого словарь не знает, сводится только по строке.
 */
const keys = new Map<string, string | null>();
const MAX_CACHED_KEYS = 50_000;

export function careerRoleKey(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const known = keys.get(trimmed);
  if (known !== undefined) return known;
  const key = rulesParse(trimmed).roleId ?? null;
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
