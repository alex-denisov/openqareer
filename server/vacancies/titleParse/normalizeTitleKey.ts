/**
 * Ключ кеша разбора названия (B267 §2, §3).
 *
 * Один и тот же смысл встречается под десятками поверхностных форм: пол
 * кандидата в скобках, город в названии, хвост с компанией после тире. Без
 * нормализации кеш `title_parse` завёл бы отдельную строку на каждую форму —
 * малая выборка показала 514 групп из 529 названий без неё.
 *
 * Слова уровня (senior, head, chief…) в ключе остаются: `rulesParse` и модель
 * выводят из них уровень, стирать их раньше времени нельзя.
 */

const BRACKETED_TAIL = /\([^)]*\)/gu;
// `\b` в JS основан на `\w`, который не видит кириллицу — границы слова
// проверяются вручную через lookaround вместо `\b`.
const REMOTE_MARKERS = /(?<![\p{L}])(remote|hybrid|удал[её]нно)(?![\p{L}])/giu;
const NUMBER_OR_HASH = /#|(?<![\p{L}\d])\d+(?![\p{L}\d])/gu;
const DASH_OR_PIPE_TAIL = /\s+[-|].*$/u;

export function normalizeTitleKey(title: string): string {
  const withoutTail = title.replace(DASH_OR_PIPE_TAIL, '');
  const withoutBrackets = withoutTail.replace(BRACKETED_TAIL, ' ');
  const withoutRemote = withoutBrackets.replace(REMOTE_MARKERS, ' ');
  const withoutNumbers = withoutRemote.replace(NUMBER_OR_HASH, ' ');
  return withoutNumbers
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}
