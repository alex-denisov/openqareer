import { titleMatchesRole } from '../../shared/vacancyRoleTitleMatch';
import { rulesParse } from './titleParse/rulesParse';

/**
 * Одна роль под разными названиями (26.10): «Технический директор» и
 * «Технический директор (CTO)», «Chief Operating Officer» и «Операционный
 * директор» — одна функция и уровень. Ключ даёт словарь ролей (онтология
 * подбора); название, которого словарь не знает, сводится только по строке.
 *
 * Одна роль — один смысл и один уровень (владелец 27.10). Руководители
 * функции делятся на две ступени:
 *  - первое лицо функции: C-level, VP и «директор» функции — CIO, IT Director
 *    и директор по IT; VP of Customer Support и Customer Support Director;
 *  - руководитель направления: Head of, «руководитель» — Head of AI и Head of
 *    AI Engineering; Head of IT Service Management — не CIO.
 * Специалисты сводятся только по роли словаря: «AI Solutions Architect» — не
 * «Software Engineer».
 */
const keys = new Map<string, string | null>();
const MAX_CACHED_KEYS = 50_000;

/** От руководителя направления (head, director) и выше. */
const LEADERSHIP_RANK = 2;
/** VP и выше — первое лицо функции. */
const TOP_RANK = 3;

/** «Директор» функции, а не руководитель внутри неё и не помощник директора. */
const DIRECTOR = /(?<!\p{L})(?:director|директор)(?!\p{L})/iu;
const BELOW_DIRECTOR =
  /(?<!\p{L})(?:head of|руководитель|associate|assistant|deputy|заместитель|помощник)(?!\p{L})/iu;

/**
 * Функции, внутри которых руководители разных смыслов: Chief of Staff — не
 * генеральный директор. Их роли сводятся только по словарю.
 */
const UNMERGED_FUNCTIONS: ReadonlySet<string> = new Set(['exec-general', 'other']);

function leadershipTier(title: string, levelRank: number): 'top' | 'head' {
  if (levelRank >= TOP_RANK) return 'top';
  return DIRECTOR.test(title) && !BELOW_DIRECTOR.test(title) ? 'top' : 'head';
}

function keyOf(title: string): string | null {
  const parsed = rulesParse(title);
  const primary = parsed.roleId?.split('.')[0] ?? parsed.functions[0];
  const rank = parsed.levelRank;
  if (!primary || rank === null || rank < LEADERSHIP_RANK || UNMERGED_FUNCTIONS.has(primary)) {
    return parsed.roleId ?? null;
  }
  return `${primary}:${leadershipTier(title, rank)}`;
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

/**
 * Основная функция названия; общий код `other` не в счёт. Только основная:
 * «Производственный директор / Технический директор» — производство, а не
 * опыт технического директора (27.10).
 */
export function careerRoleFunctions(title: string): string[] {
  const parsed = rulesParse(title.trim());
  const primary = parsed.roleId?.split('.')[0] ?? parsed.functions[0];
  return primary && primary !== 'other' ? [primary] : [];
}
