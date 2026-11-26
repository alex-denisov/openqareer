import { numbersAreSourced } from './experienceFactRewrite';

/**
 * B787: «О себе» для резюме hh.ru из «О себе» профиля (часто импорт LinkedIn About). У hh свои блоки
 * для контактов и города, поэтому в тексте их нет; нет и эмодзи с разделителями «|». Место жительства,
 * переезд и удалёнку текст не утверждает: это решает кандидат в полях hh.ru. Компании называются так,
 * как в самом резюме hh.ru. Абзац с числом без источника (подтверждённый факт или текст hh) выпадает.
 */
const CONTACT =
  /@|https?:\/\/|www\.|t\.me\/|\+?\d[\d\s()-]{8,}\d|(?<!\p{L})(?:telegram|whatsapp|e-?mail|почта|телефон|phone)(?!\p{L})/iu;
const LOCATION =
  /(?<!\p{L})(?:based in|located in|relocat\p{L}*|remote\p{L}*|open to (?:work|relocation)|available for|базирую\p{L}*|переезд\p{L}*|релокац\p{L}*|удал[её]нн\p{L}*|живу в|нахожусь в)(?!\p{L})/iu;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const BULLET = /^\s*[•·▪►✓✔\-–—*]+\s*/u;
const SEPARATOR = /\s*[|│¦]\s*/gu;
const LEGAL = /(?<![\p{L}\p{N}])(?:ооо|оао|ао|пао|зао|нао)(?![\p{L}\p{N}])|["«»“”]/giu;
const SENTENCE = /(?<=[.!?])\s+/u;

const TRANSLIT: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ы: 'y',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};
/** Короче — совпадёт с обычным словом. */
const NAME_WORD_MIN = 5;

/** Название компании в резюме hh.ru без правовой формы и кавычек: «АО "Россети Цифра"» → «Россети Цифра». */
export function plainEmployer(name: string): string {
  return name.replace(LEGAL, ' ').replace(/\s+/gu, ' ').trim();
}

const latinOf = (word: string) =>
  [...word.toLocaleLowerCase('ru-RU')].map((letter) => TRANSLIT[letter] ?? '').join('');

/** «Rosseti Digital» в тексте → «Россети Цифра»: первое слово латиницей совпадает с названием из hh. */
export function withHhEmployers(text: string, employers: readonly string[]): string {
  return employers.reduce((current, employer) => {
    const name = plainEmployer(employer);
    const first = name.split(' ')[0] ?? '';
    if (!/\p{Script=Cyrillic}/u.test(first)) return current;
    const latin = latinOf(first);
    if (latin.length < NAME_WORD_MIN) return current;
    const pattern = new RegExp(`(?<!\\p{L})${latin}(?:\\s+(?:\\p{Lu}\\p{L}+))?(?!\\p{L})`, 'giu');
    return current.replace(pattern, name);
  }, text);
}

function cleanParagraph(paragraph: string, sources: readonly string[] | null): string {
  const flat = paragraph
    .replace(EMOJI, ' ')
    .replace(BULLET, '')
    .replace(SEPARATOR, ', ')
    .replace(/\s+/gu, ' ')
    .trim();
  const kept = flat
    .split(SENTENCE)
    .filter(
      (sentence) =>
        sentence.trim() &&
        !CONTACT.test(sentence) &&
        !LOCATION.test(sentence) &&
        (!sources || numbersAreSourced(sentence, sources)),
    );
  return kept
    .join(' ')
    .replace(/^[,;:\s]+|[,;:\s]+$/gu, '')
    .trim();
}

export function hhAboutText(
  about: string,
  employers: readonly string[],
  sources: readonly string[] | null,
): string {
  return about
    .split(/\n+/u)
    .map((paragraph) => withHhEmployers(cleanParagraph(paragraph, sources), employers))
    .filter((paragraph) => /\p{L}{3}/u.test(paragraph))
    .join('\n');
}

/** Строки «станет» только с числами из подтверждённых фактов или из текста hh.ru. */
export function sourcedLines(lines: readonly string[], sources: readonly string[]): string[] {
  return lines.filter((line) => numbersAreSourced(line, sources));
}

/**
 * После перевода: переводчик передаёт русские названия латиницей («Rosseti Tsifra»), а в русском
 * резюме hh.ru компания называется как в нём самом.
 */
export function withHhEmployerNames<T extends { readonly section: string; readonly now: string }>(
  edits: readonly T[],
  employers: readonly string[],
): T[] {
  return edits.map((edit) =>
    edit.section === 'experience' || edit.section === 'about'
      ? { ...edit, now: withHhEmployers(edit.now, employers) }
      : edit,
  );
}
