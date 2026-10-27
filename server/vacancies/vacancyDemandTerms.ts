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
 * сама. Обе площадки ищут по-английски: русское название переводится через
 * словарь ролей, а непереведённое не уходит — запрос по-русски вернул бы шум.
 */

const LATIN_ONLY = /^[a-z0-9&+.,'\s-]+$/u;
const MIN_WORDS = 2;
const MAX_TERM_LENGTH = 60;
const KNOWN_TERMS: ReadonlySet<string> = new Set(FAN_TERMS);

const ENGLISH_BY_ROLE_ID: ReadonlyMap<string, string> = new Map(
  ontology.roles.flatMap((role) => {
    const english = role.variants.en[0] ?? role.titleEn;
    return english ? [[role.id, english] as const] : [];
  }),
);

/** Руководитель функции, которую словарь узнал без точной роли. */
const HEAD_BY_FUNCTION: ReadonlyMap<string, string> = new Map(
  ontology.roles
    .filter((role) => role.levels.includes('head'))
    .reverse()
    .map((role) => [role.function, role.variants.en[0] ?? role.titleEn] as const),
);

const LEADERSHIP_RANK = 2;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function translate(part: string): string | null {
  const parsed = rulesParse(part);
  const exact = parsed.roleId ? ENGLISH_BY_ROLE_ID.get(parsed.roleId) : undefined;
  if (exact) return exact;
  const primary = parsed.functions[0];
  if (primary && parsed.levelRank !== null && parsed.levelRank >= LEADERSHIP_RANK) {
    return HEAD_BY_FUNCTION.get(primary) ?? null;
  }
  return null;
}

function termFor(part: string): string | null {
  const normalized = normalize(part);
  const english = LATIN_ONLY.test(normalized) ? normalized : normalize(translate(part) ?? '');
  if (!english || !LATIN_ONLY.test(english)) return null;
  if (english.split(' ').length < MIN_WORDS || english.length > MAX_TERM_LENGTH) return null;
  return english;
}

export function searchTermsForRoles(titles: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const title of titles) {
    for (const part of title.split(/\s+\/\s+|\s*\|\s*/u)) {
      const term = termFor(part);
      if (term && !KNOWN_TERMS.has(term)) terms.add(term);
    }
  }
  return [...terms];
}
