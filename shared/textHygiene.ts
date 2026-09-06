/**
 * Невидимые метки в тексте кандидата (B210).
 *
 * Генеративные модели вставляют в ответ символы нулевой ширины, форматные и
 * теговые символы: глазами их не видно, а в файле они есть. Кандидат
 * отправляет такой текст работодателю, не зная, что несёт в нём чужую метку,
 * которую он не писал и не может увидеть.
 *
 * Правило простое: в тексте остаётся только то, что человек может прочесть.
 * Модуль чистый — без React и без Node-специфики, поэтому работает и на
 * сервере, и в браузере.
 */

/** Символы нулевой ширины и склейки слов. */
const ZERO_WIDTH = new Set(['​', '‌', '⁠', '﻿', '᠎']);

/** Мягкий перенос: невидим, но рвёт слово при копировании. */
const SOFT_HYPHEN = '­';

/**
 * Управление направлением письма и прочие форматные символы. В русском и
 * английском тексте им делать нечего, а меткой они работают отлично.
 */
const BIDI_AND_FORMAT = new Set([
  '‎',
  '‏',
  '‪',
  '‫',
  '‬',
  '‭',
  '‮',
  '⁡',
  '⁢',
  '⁣',
  '⁤',
  '⁦',
  '⁧',
  '⁨',
  '⁩',
  '⁪',
  '⁫',
  '⁬',
  '⁭',
  '⁮',
  '⁯',
]);

const ZERO_WIDTH_JOINER = '‍';

/** Стеганографические теговые символы U+E0000–U+E007F. */
function isTagCharacter(codePoint: number): boolean {
  return codePoint >= 0xe0000 && codePoint <= 0xe007f;
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

export interface HiddenMarkerAudit {
  readonly total: number;
  readonly zeroWidth: number;
  readonly softHyphen: number;
  readonly bidi: number;
  readonly tagCharacters: number;
  /**
   * Слова, в которых буквы двух алфавитов стоят вперемешку («paбoты»). Это
   * тоже метка, но исправлять её автоматически нельзя: в живом русском тексте
   * «1С» и названия продуктов законно смешивают алфавиты, и переписать их
   * значило бы испортить то, что кандидат написал сам. Поэтому — называем.
   */
  readonly mixedScriptWords: readonly string[];
}

/**
 * ZWJ склеивает эмодзи в одну картинку. Снести его вслепую — разобрать «👨‍💻»
 * на двух человечков в тексте, который кандидат написал сам, поэтому между
 * пиктограммами он остаётся.
 */
function joinerIsMeaningful(characters: readonly string[], index: number): boolean {
  const before = characters[index - 1];
  const after = characters[index + 1];
  return Boolean(before && after && PICTOGRAPHIC.test(before) && PICTOGRAPHIC.test(after));
}

function isRemovable(character: string, characters: readonly string[], index: number): boolean {
  if (ZERO_WIDTH.has(character) || BIDI_AND_FORMAT.has(character)) return true;
  if (character === SOFT_HYPHEN) return true;
  if (character === ZERO_WIDTH_JOINER) return !joinerIsMeaningful(characters, index);
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && isTagCharacter(codePoint);
}

/** Текст без невидимых меток. Видимые символы, пробелы и переносы не трогаются. */
export function stripHiddenMarkers(text: string): string {
  const characters = Array.from(text);
  const kept = characters.filter((character, index) => !isRemovable(character, characters, index));
  return kept.length === characters.length ? text : kept.join('');
}

const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

function mixedScriptWords(text: string): string[] {
  return Array.from(text.matchAll(/[\p{L}\p{M}]+/gu), (match) => match[0]).filter(
    (word) => LATIN.test(word) && CYRILLIC.test(word),
  );
}

/** Что именно нашлось в тексте — для отчёта, а не для молчаливой правки. */
export function auditHiddenMarkers(text: string): HiddenMarkerAudit {
  const characters = Array.from(text);
  let zeroWidth = 0;
  let softHyphen = 0;
  let bidi = 0;
  let tagCharacters = 0;

  characters.forEach((character, index) => {
    if (ZERO_WIDTH.has(character)) zeroWidth += 1;
    else if (character === SOFT_HYPHEN) softHyphen += 1;
    else if (BIDI_AND_FORMAT.has(character)) bidi += 1;
    else if (character === ZERO_WIDTH_JOINER && !joinerIsMeaningful(characters, index))
      zeroWidth += 1;
    else {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && isTagCharacter(codePoint)) tagCharacters += 1;
    }
  });

  return {
    total: zeroWidth + softHyphen + bidi + tagCharacters,
    zeroWidth,
    softHyphen,
    bidi,
    tagCharacters,
    mixedScriptWords: mixedScriptWords(stripHiddenMarkers(text)),
  };
}

/**
 * Чистит каждую строку внутри значения любой глубины и возвращает **тот же**
 * объект, когда чистить было нечего: ответ модели не пересобирается на каждом
 * ходу без причины.
 */
export function sanitizeHiddenMarkersDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return stripHiddenMarkers(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const sanitized = sanitizeHiddenMarkersDeep(item);
      if (sanitized !== item) changed = true;
      return sanitized;
    });
    return changed ? (next as unknown as T) : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitized = sanitizeHiddenMarkersDeep(item);
      if (sanitized !== item) changed = true;
      next[key] = sanitized;
    }
    return changed ? (next as unknown as T) : value;
  }
  return value;
}
