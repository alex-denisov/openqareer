import { ontology } from '../../shared/roleOntology';
import { FAN_TERMS } from './jobspyFan';
import { rulesParse } from './titleParse/rulesParse';

/**
 * Роли кандидатов — запросы к LinkedIn и Indeed (решение владельца 27.10).
 *
 * Общий веер читает постоянный список ролей. Кандидат с ролью вне него
 * (Head of AI, руководитель поддержки, главный бухгалтер) получал ноль
 * вакансий из этих площадок, сколько бы их там ни было. Поэтому роль, которую
 * кандидат выбрал или которую ему назвал консультант, становится запросом
 * сама. LinkedIn и Indeed ищут по-английски: русское название переводится
 * через словарь ролей. hh ищет по-русски: «Главный бухгалтер» там не
 * «head of accounting», поэтому русское название роли, которую словарь узнал,
 * остаётся запросом рядом с переводом. Название вне словаря не уходит вовсе.
 */

const LATIN_ONLY = /^[a-z0-9&+.,'\s-]+$/u;
const CYRILLIC_ROLE = /^[\p{Script=Cyrillic}a-z0-9&+.,'\s-]+$/u;

const MIN_WORDS = 2;
const MAX_TERM_LENGTH = 60;
const KNOWN_TERMS: ReadonlySet<string> = new Set(FAN_TERMS);

/** Сколько английских формулировок получает руководящая роль: рынок называет её по-разному. */
const LEADER_VARIANTS = 5;

/** Английские названия роли словаря: у руководящих — несколько, у остальных — одно. */
function englishVariants(role: (typeof ontology.roles)[number]): string[] {
  const leader = role.levels.some((level) => level === 'head' || level === 'vp' || level === 'c-level');
  const all = role.variants.en.length > 0 ? role.variants.en : [role.titleEn];
  return all.filter(Boolean).slice(0, leader ? LEADER_VARIANTS : 1);
}

const ENGLISH_BY_ROLE_ID: ReadonlyMap<string, readonly string[]> = new Map(
  ontology.roles.map((role) => [role.id, englishVariants(role)] as const),
);

/** Руководитель функции, которую словарь узнал без точной роли. */
const HEAD_BY_FUNCTION: ReadonlyMap<string, readonly string[]> = new Map(
  ontology.roles
    .filter((role) => role.levels.includes('head'))
    .reverse()
    .map((role) => [role.function, englishVariants(role)] as const),
);

const LEADERSHIP_RANK = 2;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function translate(part: string): readonly string[] {
  const parsed = rulesParse(part);
  const exact = parsed.roleId ? ENGLISH_BY_ROLE_ID.get(parsed.roleId) : undefined;
  if (exact?.length) return exact;
  const primary = parsed.functions[0];
  if (primary && parsed.levelRank !== null && parsed.levelRank >= LEADERSHIP_RANK) {
    return HEAD_BY_FUNCTION.get(primary) ?? [];
  }
  return [];
}

function fitsTerm(term: string): boolean {
  return term.split(' ').length >= MIN_WORDS && term.length <= MAX_TERM_LENGTH;
}

/** Русское название роли, которую словарь узнал, — запрос для hh. */
function russianTermFor(part: string): string | null {
  const normalized = normalize(part);
  if (LATIN_ONLY.test(normalized) || !CYRILLIC_ROLE.test(normalized)) return null;
  const known = rulesParse(part).functions.some((code) => code !== 'other');
  return known && fitsTerm(normalized) ? normalized : null;
}

function termsFor(part: string): string[] {
  const normalized = normalize(part);
  const candidates = LATIN_ONLY.test(normalized)
    ? [normalized]
    : translate(part).map((english) => normalize(english));
  return candidates.filter(
    (english) =>
      english &&
      LATIN_ONLY.test(english) &&
      english.split(' ').length >= MIN_WORDS &&
      english.length <= MAX_TERM_LENGTH,
  );
}

export function searchTermsForRoles(titles: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const title of titles) {
    for (const part of title.split(/\s+\/\s+|\s*\|\s*/u)) {
      for (const term of termsFor(part)) {
        if (!KNOWN_TERMS.has(term)) terms.add(term);
      }
      const russian = russianTermFor(part);
      if (russian) terms.add(russian);
    }
  }
  return [...terms];
}
