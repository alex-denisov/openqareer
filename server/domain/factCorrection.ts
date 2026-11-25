/**
 * B796: кандидат исправил факт — та же цифра стоит в других записях, часто на другом языке. Копию узнаём
 * по числам: пара соседних чисел («16 % до 80 %» — «16% to 80%») или, когда сосед не назван, общие слова
 * вокруг числа. Слова копии не переписываются, меняется только исправленное число.
 */
export interface NumberChange {
  readonly from: string;
  readonly to: string;
  /** Число, стоящее рядом в исходной записи: по паре узнаётся копия на другом языке. */
  readonly beside: string | null;
  /** Соседнее число тоже убрано: в копии пара заменяется одним числом. */
  readonly dropsBeside: boolean;
  /** Основы слов вокруг числа: узнают копию без пары чисел. */
  readonly words: readonly string[];
}

interface NumberToken {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const NUMBER = /\d+(?:[.,]\d+)*/gu;
const PAIR_GAP = /^\s*%?\s*(?:до|to|→|➔|–|—|-|->)\s*(?:~\s*)?$/iu;
const UNIT = /^\s*%/u;
const STEM = 5;
const WORD_MIN = 4;
const WINDOW = 70;
const SHARED_WORDS = 2;

const tokens = (text: string): NumberToken[] =>
  [...text.matchAll(NUMBER)].map((match) => ({
    value: match[0].replace(',', '.'),
    start: match.index,
    end: match.index + match[0].length,
  }));

const stems = (text: string): string[] => [
  ...new Set(
    (
      text
        .toLocaleLowerCase('ru')
        .replace(/ё/gu, 'е')
        .match(/\p{L}+/gu) ?? []
    )
      .filter((word) => word.length >= WORD_MIN)
      .map((word) => word.slice(0, STEM)),
  ),
];

const around = (text: string, token: NumberToken): string =>
  text.slice(Math.max(0, token.start - WINDOW), token.end + WINDOW);

function pairedBefore(text: string, list: readonly NumberToken[], index: number) {
  const previous = list[index - 1];
  const token = list[index];
  if (!previous || !token) return null;
  return PAIR_GAP.test(text.slice(previous.end, token.start)) ? previous : null;
}

/** Позиции, где числа двух записей расходятся: убранные и вставшие на их место. */
function differing(before: readonly NumberToken[], after: readonly NumberToken[]) {
  let head = 0;
  while (head < before.length && head < after.length && before[head]!.value === after[head]!.value)
    head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail]!.value === after[after.length - 1 - tail]!.value
  )
    tail += 1;
  return {
    removed: { from: head, to: before.length - tail },
    added: after.slice(head, after.length - tail),
  };
}

/** Что изменилось в числах; `null` — изменились не числа или изменение однозначно не сводится к замене. */
export function numberChanges(before: string, after: string): readonly NumberChange[] | null {
  const old = tokens(before);
  const { removed, added } = differing(old, tokens(after));
  const count = removed.to - removed.from;
  if (added.length === 0) return count === 0 ? [] : null;
  const change = (index: number, to: string, dropsBeside: boolean): NumberChange => ({
    from: old[index]!.value,
    to,
    beside: pairedBefore(before, old, index)?.value ?? null,
    dropsBeside,
    words: stems(around(before, old[index]!)),
  });
  if (count === 2 && added.length === 1) {
    const last = removed.to - 1;
    return pairedBefore(before, old, last) ? [change(last, added[0]!.value, true)] : null;
  }
  if (count !== added.length) return null;
  return added.flatMap((token, offset) => {
    const index = removed.from + offset;
    return old[index]!.value === token.value ? [] : [change(index, token.value, false)];
  });
}

function isSameMetric(
  text: string,
  list: readonly NumberToken[],
  index: number,
  change: NumberChange,
): boolean {
  const token = list[index]!;
  if (token.value !== change.from) return false;
  if (change.beside !== null) return pairedBefore(text, list, index)?.value === change.beside;
  if (pairedBefore(text, list, index)) return false;
  const nearby = new Set(stems(around(text, token)));
  return change.words.filter((word) => nearby.has(word)).length >= SHARED_WORDS;
}

const FROM_WORD = /(?:from|с|со)\s*$/iu;

function replaced(text: string, list: readonly NumberToken[], index: number, change: NumberChange) {
  const token = list[index]!;
  const beside = change.dropsBeside ? pairedBefore(text, list, index) : null;
  if (!beside) return `${text.slice(0, token.start)}${change.to}${text.slice(token.end)}`;
  const lead = text.slice(0, beside.start);
  const linked = FROM_WORD.test(lead);
  const word = /\p{Script=Cyrillic}/u.test(text) ? 'до ' : 'to ';
  return `${linked ? lead.replace(FROM_WORD, word) : lead}${change.to}${text.slice(token.end)}`;
}

/** Запись с исправленными числами; `null` — исправляемого факта в ней нет. */
export function correctedCopy(text: string, changes: readonly NumberChange[]): string | null {
  // «Не 80 %, а 40 %» — сама правка словами кандидата: старое число в ней названо нарочно.
  if (statedCorrection(text)) return null;
  let current = text;
  for (const change of changes) {
    let list = tokens(current);
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (!isSameMetric(current, list, index, change)) continue;
      current = replaced(current, list, index, change);
      list = tokens(current).slice(0, index);
    }
  }
  return current === text ? null : current;
}

export interface StatedCorrection {
  readonly from: string;
  readonly to: string;
}

const N = String.raw`(\d+(?:[.,]\d+)*)\s*(?:%|процент\p{L}*)?`;
const STATED: readonly { readonly pattern: RegExp; readonly from: 1 | 2 }[] = [
  {
    pattern: new RegExp(
      String.raw`(?:не|not)\s+(?:до\s+)?${N}[\s,;:—–-]*(?:а|but|,)\s*(?:до\s+)?${N}`,
      'giu',
    ),
    from: 1,
  },
  {
    pattern: new RegExp(String.raw`(?:вместо|instead of)\s+${N}[^\d.!?]{0,30}${N}`, 'giu'),
    from: 1,
  },
  {
    pattern: new RegExp(String.raw`${N}\s*,?\s*(?:а\s+не|вместо|not|instead of)\s+${N}`, 'giu'),
    from: 2,
  },
  { pattern: new RegExp(String.raw`${N}[^\d.!?]{0,20}(?:на|to|→)\s+${N}`, 'giu'), from: 1 },
];
const ASKS_CHANGE =
  /исправ|замен|поменя|измен|поправ|обнов|correct|replace|change|fix|неверн|ошиб/iu;

/** Исправление, которое кандидат назвал сам: «не 80 %, а 40 %», «40 вместо 80». */
export function statedCorrection(message: string): StatedCorrection | null {
  for (const [index, { pattern, from }] of STATED.entries()) {
    // «80 на 40» без просьбы исправить — обычный рассказ.
    if (index === STATED.length - 1 && !ASKS_CHANGE.test(message)) continue;
    const match = [...message.matchAll(pattern)][0];
    if (!match) continue;
    const numbers = [match[1]!, match[2]!].map((item) => item.replace(',', '.'));
    const old = numbers[from - 1]!;
    const next = numbers[from === 1 ? 1 : 0]!;
    if (old !== next) return { from: old, to: next };
  }
  return null;
}

/** Текст с исправлением, которое назвал кандидат: число той же единицы. */
export function applyStated(
  text: string,
  { from, to }: StatedCorrection,
  percent: boolean,
): string | null {
  if (statedCorrection(text)) return null;
  const list = tokens(text).filter(
    (token) => token.value === from && (!percent || UNIT.test(text.slice(token.end))),
  );
  if (list.length !== 1) return null;
  const [token] = list;
  return `${text.slice(0, token!.start)}${to}${text.slice(token!.end)}`;
}

export const saysPercent = (message: string): boolean => /\d\s*(?:%|процент)/iu.test(message);

const WRITE_CLAIM =
  /(?<!\p{L})(?:меняю|изменил[аи]?|изменяю|исправил[аи]?|исправляю|исправлено|обновил[аи]?|обновляю|обновлено|заменил[аи]?|заменяю|заменено|поправил[аи]?|поправлено|внёс|внес|внесла|вношу|записал[аи]?|записываю|сохранил[аи]?|сохранено|удалил[аи]?|добавил[аи]?\s+в\s+(?:профиль|резюме)|i(?:'ve| have)?\s+(?:changed|updated|corrected|fixed|replaced)|i(?:'m| am)\s+(?:changing|updating))(?!\p{L})/iu;
const PROFILE_OBJECT =
  /цифр|числ|профил|резюме|запис|пункт|факт|«О себе»|строк|мест|правк|profile|resume|figure|number/iu;
const SHORT_CLAIM_WORDS = 3;
const FOREIGN_SUBJECT =
  /(?<!\p{L})(?:вы|вами|вас|you|кто|который|которая|команда|компания)(?!\p{L})/iu;

/**
 * Консультант не пишет в профиль: слова «исправил» в его реплике — ложный успех. Такие предложения
 * заменяются правдой: карточка правки или отказ.
 */
export function withoutWriteClaims(message: string, hasCard: boolean): string {
  let found = false;
  const kept = message
    .split(/(?<=[.!?…])(?=\s)|(?=\n)/u)
    .filter((sentence) => {
      const claim =
        WRITE_CLAIM.test(sentence) &&
        (PROFILE_OBJECT.test(sentence) ||
          sentence.trim().split(/\s+/u).length <= SHORT_CLAIM_WORDS) &&
        !FOREIGN_SUBJECT.test(sentence) &&
        !sentence.includes('?');
      found ||= claim;
      return !claim;
    })
    .join('')
    .trim();
  if (!found) return message;
  const truth = hasCard
    ? 'Правка готова ниже: в профиль она встанет после «Применить».'
    : 'Сам профиль я не меняю: поправьте запись в «Профиле».';
  return kept ? `${kept}\n\n${truth}` : truth;
}
