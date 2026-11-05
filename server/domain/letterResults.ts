import { hasCyrillic } from './cyrillic';

/**
 * Результаты абзаца «опыт» (G3b, 03.11): под каждым местом экран пишет «Для
 * письма доступно: N подтверждённых фактов», значит, в письме должны быть
 * именно они — пункты мест работы, итоги первыми, не больше двух. Запись о
 * самом месте (хронология) — не результат: место уже названо фразой о карьере.
 * Русский пункт попадает в английское письмо только переведённым.
 */

export interface LetterResultFact {
  readonly id: string;
  readonly statement: string;
  readonly domain?: string;
}

export interface LetterResultWorkplace {
  /** Запись хронологии о месте; её id тоже есть в `evidenceIds`. */
  readonly recordId?: string | null;
  readonly evidenceIds: readonly string[];
}

export type LetterLanguage = 'en' | 'ru';

const WORKPLACE_RESULT_LIMIT = 2;

// Начало слова: иначе «cut» находится в «executive», «led» — в «skilled».
const OUTCOME_VERB = /(?<!\p{L})(?:созда|основа|возглав|руковод|разработа|внедр|запуст|увелич|сниз|сократ|добил|постро|удво|вырос|выраст|led|founded|created|built|launched|grew|increased|reduced|cut|achieved|implemented|doubled|delivered|managed|scaled)/iu;

/**
 * Записи профиля «Заголовок\nПоле: значение» (образование, язык, место
 * работы) — данные для экрана, а не фразы: в письмо их не цитируем (B496).
 */
export function isStructuredRecordStatement(statement: string): boolean {
  return /\n[^\n:]{2,40}:\s/u.test(statement);
}

/**
 * Результат — фраза с итогом, а не строка навыка: «Kubernetes. Kafka. Go.»
 * под заголовком «Among my results» читается как подмена (G3 L1, 03.11).
 */
export function isResultFact(fact: LetterResultFact): boolean {
  if (fact.domain === 'skill' || isStructuredRecordStatement(fact.statement)) return false;
  if ((fact.statement.match(/[\p{L}\p{N}]+/gu) ?? []).length < 3) return false;
  // role-evidence — опыт выбранной роли кампании, его ставит первым ранжирование.
  return fact.domain === 'outcome' || fact.domain === 'role-evidence' ||
    /\d/u.test(fact.statement) || OUTCOME_VERB.test(fact.statement);
}

function recordIds(workplaces: readonly LetterResultWorkplace[]): Set<string> {
  return new Set(workplaces.flatMap((place) => (place.recordId ? [place.recordId] : [])));
}

/** Пункты выбранных мест (без записей о самих местах), итоги первыми. */
function workplaceResults<T extends LetterResultFact>(
  facts: readonly T[],
  workplaces: readonly LetterResultWorkplace[],
): T[] {
  const records = recordIds(workplaces);
  const order = workplaces.flatMap((place) => place.evidenceIds).filter((id) => !records.has(id));
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const bullets = [...new Set(order)].flatMap((id) => {
    const fact = byId.get(id);
    return fact && isResultFact(fact) ? [fact] : [];
  });
  const outcomeFirst = (fact: T) => (fact.domain === 'outcome' ? 0 : 1);
  return [...bullets].sort((a, b) => outcomeFirst(a) - outcomeFirst(b));
}

/** «with the team growing…» держится на теме: вынесенное вперёд, оно ломает фразу (прод 05.11). */
const DEPENDENT_TAIL = /^(?:with|as|while|when|где|при|когда)\s/iu;
const PAST_ACTION = /(?<!\p{L})\p{L}+(?:л|ла|ли|ло|ed)(?!\p{L})/iu;

/** Первая буква фразы после двоеточия: имя, аббревиатура и чужая азбука остаются как есть. */
export function lowerLetterStart(
  text: string,
  language: LetterLanguage,
  names: ReadonlySet<string> = new Set(),
): string {
  const [word = '', next = ''] = text.split(/\s+/u);
  const keep = word.length < 2 || /\p{Lu}.*\p{Lu}/u.test(word) || /^\p{Lu}/u.test(next) ||
    names.has(word) || (language === 'ru') !== hasCyrillic(word.charAt(0));
  return keep ? text : text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

/**
 * «Склад и логистика для сети, команда выросла с 8 до 35» читается как название проекта (G3c):
 * итог с числом идёт первым, тема за ним. Фраза, которая сама называет действие, не меняется.
 */
export function resultFirst(statement: string, language: LetterLanguage): string {
  const text = statement.trim().replace(/[.;,\s]+$/u, '');
  const [, head, tail] = /^([^,;]+)[,;]\s+(.+)$/u.exec(text) ?? [];
  if (!head || !tail || /\d/u.test(head) || !/\d/u.test(tail)) return text;
  if (OUTCOME_VERB.test(head) || PAST_ACTION.test(head) || DEPENDENT_TAIL.test(tail)) return text;
  return `${tail} — ${lowerLetterStart(head, language)}`;
}

/** Сколько результатов без места переводить для модели: она выбирает 1–2 доказательства из этого списка. */
const UNBOUND_RESULT_LIMIT = 4;

/**
 * Русские пункты, которые английское письмо может использовать только в переводе. Шаблон цитирует
 * пункты мест; модели нужны и результаты без места, иначе ей не из чего выбирать (письма 2 и 4, G3d).
 */
export function letterFactsToTranslate<T extends LetterResultFact>(
  facts: readonly T[],
  workplaces: readonly LetterResultWorkplace[],
  language: LetterLanguage,
  forModel = false,
): T[] {
  if (language !== 'en') return [];
  const bound = workplaceResults(facts, workplaces)
    .filter((fact) => hasCyrillic(fact.statement))
    .slice(0, WORKPLACE_RESULT_LIMIT);
  if (!forModel) return bound;
  const records = recordIds(workplaces);
  const taken = new Set(bound.map((fact) => fact.id));
  const others = facts
    .filter((fact) => !taken.has(fact.id) && !records.has(fact.id) && hasCyrillic(fact.statement) && isResultFact(fact))
    .slice(0, UNBOUND_RESULT_LIMIT);
  return [...bound, ...others];
}

/** Факты с переведёнными формулировками: письмо и проверка фактов видят один текст. */
export function withTranslatedStatements<T extends LetterResultFact>(
  facts: readonly T[],
  translations: ReadonlyMap<string, string> | undefined,
): T[] {
  if (!translations || translations.size === 0) return [...facts];
  return facts.map((fact) => {
    const statement = translations.get(fact.id);
    return statement ? { ...fact, statement } : fact;
  });
}

/**
 * Результаты для письма: пункты мест работы (до двух, итоги первыми), если
 * они есть на языке письма; иначе — прежний отбор по ранжированию. Записи о
 * местах не цитируются никогда.
 */
export function orderLetterResults<T extends LetterResultFact>(
  results: readonly T[],
  workplaces: readonly LetterResultWorkplace[],
): T[] {
  const records = recordIds(workplaces);
  const usable = results.filter((fact) => !records.has(fact.id));
  const fromPlaces = workplaceResults(usable, workplaces).slice(0, WORKPLACE_RESULT_LIMIT);
  return fromPlaces.length > 0 ? fromPlaces : usable;
}
