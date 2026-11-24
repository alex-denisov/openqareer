import { SELECTION_UNKNOWN, type SelectionContext, type SelectionRow } from './selectionSummary';

/**
 * B735: что в ответе консультанта о подборке сервер может опровергнуть по строкам: страна без
 * данных, неверный счёт по городу, «удалёнки из РФ не видно», «остальные — Remote». Правило
 * бракует только то, чему строки прямо противоречат; спорное остаётся.
 */
const HOME = 'Россия';
const ADMITS_UNKNOWN =
  /неизвест|не указан|не назван|не сказан|нет данных|не видно страны|уточн|спрос|узна|можно ли/iu;
const FOREIGN = /(?<!(?:не|ни)\s)зарубеж|иностран|за границ|за рубеж/iu;
const REMOTE = /remote|удал[её]н/iu;
const LEADING_ROWS = /(?:перв|верхн)\p{L}*\s+(?:строк|ваканс|позици)/iu;
const DENIES = /не видно|не вижу|\bнет\b|(?<!\p{L})нет(?!\p{L})|отсутству/iu;
const HOME_WORD = /(?<!\p{L})(?:росси|рф(?!\p{L}))/iu;
const COUNTRY_STEMS =
  /(?<!\p{L})(?:сша|германи|великобритани|кипр|оаэ|казахстан|серби|грузи[яию]|армени|канад|инди[яию](?!\p{L})|польш|нидерланд|испани|франци|итали|португал|израил|турци|сингапур)/iu;
const NUMBER_WORDS: readonly string[] = [
  'ноль',
  'од(?:на|ин|но)',
  'дв[аеу]х?',
  'тр(?:и|ёх|ех)',
  'четыр(?:е|ёх|ех)',
  'пят[ьи]',
  'шест[ьи]',
  'сем[ьи]',
  'вос[е]?м[ьи]',
  'девят[ьи]',
  'десят[ьи]',
  'одиннадцат[ьи]',
  'двенадцат[ьи]',
  'тринадцат[ьи]',
  'четырнадцат[ьи]',
  'пятнадцат[ьи]',
  'шестнадцат[ьи]',
  'семнадцат[ьи]',
  'восемнадцат[ьи]',
  'девятнадцат[ьи]',
  'двадцат[ьи]',
];
const NUMBER = `(?<![\\p{L}\\d])(\\d{1,2}|${NUMBER_WORDS.join('|')})(?![\\p{L}\\d])(?!\\s*%)`;
/** Счёт с ещё одним условием («6 в Москве с гибридом») со сводкой по городу не сравнить. */
const EXTRA_CONDITION = /гибрид|офис|удал|remote|%|процент|выше|зарплат|от\s+\d/iu;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function numberOf(text: string): number {
  if (/^\d+$/u.test(text)) return Number(text);
  return NUMBER_WORDS.findIndex((word) => new RegExp(`^(?:${word})$`, 'iu').test(text));
}

function names(sentence: string, row: SelectionRow): boolean {
  return [row.company, row.title].some(
    (name) =>
      name !== null &&
      name.length > 2 &&
      new RegExp(`(?<![\\p{L}\\d])${escape(name)}(?![\\p{L}\\d])`, 'iu').test(sentence),
  );
}

const isForeign = (row: SelectionRow) => row.country !== null && row.country !== HOME;
const isRemote = (row: SelectionRow) => row.format !== null && REMOTE.test(row.format);

function wrongForeign(sentence: string, rows: readonly SelectionRow[]): boolean {
  if (!FOREIGN.test(sentence)) return false;
  const named = rows.filter((row) => names(sentence, row));
  if (named.length > 0) return named.every((row) => !isForeign(row));
  const first = rows[0];
  // «Среди первых строк есть зарубежные» — не обо всех.
  if (/среди|есть|встреча/iu.test(sentence)) return false;
  return first !== undefined && LEADING_ROWS.test(sentence) && !isForeign(first);
}

/** Страна названа у единственной строки, где её нет ни в месте, ни в формате, ни в названии. */
function inventedCountry(sentence: string, rows: readonly SelectionRow[]): boolean {
  const named = rows.filter((row) => names(sentence, row));
  if (named.length !== 1 || named[0]!.country !== null) return false;
  const { title, company, location, format } = named[0]!;
  const known = [title, company, location, format].filter(Boolean).join(' ');
  return COUNTRY_STEMS.test(sentence) && !COUNTRY_STEMS.test(known);
}

function wrongCityCount(sentence: string, selection: SelectionContext): boolean {
  if (EXTRA_CONDITION.test(sentence)) return false;
  return selection.summary.byPlace.some(({ label, count }) => {
    if (label === SELECTION_UNKNOWN || !/^\p{L}{4,}$/u.test(label)) return false;
    const city = `(?<!\\p{L})в[о]?\\s+${escape(label.slice(0, -1))}\\p{L}{0,2}(?!\\p{L})`;
    const before = new RegExp(
      `${NUMBER}(?:\\s+(?:из\\s+[\\p{L}\\d]+|ваканс\\p{L}*|строк\\p{L}*|находятся|находится))*\\s*[—–:-]?\\s*${city}`,
      'iu',
    ).exec(sentence);
    const after = new RegExp(`${city}\\s*[—–:-]?\\s*${NUMBER}`, 'iu').exec(sentence);
    const said = before?.[1] ?? after?.[1];
    return said !== undefined && numberOf(said) >= 0 && numberOf(said) !== count;
  });
}

function deniesHomeRemote(sentence: string, rows: readonly SelectionRow[]): boolean {
  if (!REMOTE.test(sentence) || !HOME_WORD.test(sentence) || !DENIES.test(sentence)) return false;
  return rows.some((row) => isRemote(row) && (row.country === HOME || HOME_WORD.test(row.format!)));
}

/** «Остальные — Remote»: строка, не названная в ответе, этому противоречит. */
function wrongRest(sentence: string, message: string, rows: readonly SelectionRow[]): boolean {
  if (!REMOTE.test(sentence) || !/(?<!\p{L})остальны/iu.test(sentence)) return false;
  return rows.some((row) => !names(message, row) && !isRemote(row));
}

function broken(sentence: string, message: string, selection: SelectionContext): boolean {
  const { rows } = selection;
  if (wrongCityCount(sentence, selection) || deniesHomeRemote(sentence, rows)) return true;
  if (wrongRest(sentence, message, rows)) return true;
  if (ADMITS_UNKNOWN.test(sentence)) return false;
  return wrongForeign(sentence, rows) || inventedCountry(sentence, rows);
}

/** Предложения вместе с пробелами после них: склейка даёт исходный текст. */
const sentencesOf = (message: string): readonly string[] =>
  message
    .match(/[^.!?…;\n]*(?:[.!?…;]+(?=\s|$)|[.!?…;]+(?=\S)[^.!?…;\n]*|\n|$)\s*/gu)
    ?.filter(Boolean) ?? [];

export function selectionClaimsHold(
  message: string,
  selection: SelectionContext | undefined,
): boolean {
  if (!selection || selection.rows.length === 0) return true;
  return sentencesOf(message).every((sentence) => !broken(sentence, message, selection));
}

/** Ни одна ступень не ответила верно: опровергнутые предложения из ответа убираются. */
export function withoutBrokenClaims(
  message: string,
  selection: SelectionContext | undefined,
): string {
  if (!selection || selectionClaimsHold(message, selection)) return message;
  return sentencesOf(message)
    .filter((sentence) => !broken(sentence, message, selection))
    .join('')
    .trim();
}
