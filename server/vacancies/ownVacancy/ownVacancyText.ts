/**
 * B676: своя вакансия из вставленного текста.
 *
 * Прод 18.11: текст, вставленный одной строкой, давал 0 требований (правила читают
 * строки), а название было первыми 160 знаками; компания и место оставались «—».
 * Текст одной строкой разбивается по заголовкам разделов, пунктам и фразам; поля
 * берутся только из явных строк «Компания:», «Город:» и слов формата работы.
 */
import { OWN_VACANCY_TITLE_MAX } from '../../../shared/b640OwnVacancy';
import type { OwnVacancyWorkFormat } from '../../../shared/b640OwnVacancy';
import { detectVacancyWorkFormat } from '../../../shared/vacancyWorkFormat';
import type { NewOwnVacancy } from '../../data/sqliteOwnVacancyStore';
import { salaryFromText } from './ownVacancySalary';

/** Текст со строками короче этого на строку уже разбит на строки самим кандидатом. */
const FLAT_CHARS_PER_LINE = 300;
const TITLE_SOFT_MAX = 100;

const HEADERS =
  'требования|обязанности|условия|мы предлагаем|мы ожидаем|что мы ждём|что мы ждем|задачи|о компании|компания|работодатель|город|локация|место работы|' +
  'requirements|qualifications|responsibilities|what we offer|benefits|about us|company|employer|location|city';
const HEADER_BEFORE = new RegExp(`\\s+(?=(?:${HEADERS})\\s*[:：])`, 'giu');
const LIST_HEADER =
  /^((?:требования|обязанности|условия|мы предлагаем|мы ожидаем|что мы ждём|что мы ждем|задачи|requirements|qualifications|responsibilities|what we offer|benefits)\s*[:：])\s*(.+)$/iu;

const COMPANY_LINE = /^(?:компания|работодатель|company|employer)\s*[:：]\s*(.+)$/iu;
const LOCATION_LINE = /^(?:город|локация|место работы|location|city)\s*[:：]\s*(.+)$/iu;
const REMOTE = /удал[её]нн|удал[её]нка|remote/iu;
/** Слово формата работы: строка «Москва, гибрид» называет город рядом с ним (B676, прод 23.11). */
const FORMAT_WORD = /удал[её]нн|удал[её]нка|гибрид|офис|remote|hybrid|office|on-?site/iu;
const FORMAT_LINE_MAX = 60;
const CITY_MAX = 40;
const CITY_WORDS_MAX = 3;

/**
 * A run of spaces becomes one first: every later pattern then meets at most one blank in a row,
 * so a 30 000-character paste of blanks or dots cannot make the matching quadratic.
 */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ \n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function isFlat(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim()).length;
  return lines <= 1 || text.length / lines > FLAT_CHARS_PER_LINE;
}

/** Строка раздела «Требования: a; b; c» — заголовок и по пункту на строку. */
function splitListLine(line: string): string[] {
  const header = LIST_HEADER.exec(line);
  const [head, body] = header ? [header[1], header[2]] : [null, line];
  const items = body.split(/\s*;\s*|\s+[•▪·]\s*|\s+(?=\d+[.)]\s)/u).filter(Boolean);
  return head ? [head, ...items] : items;
}

/** Текст одной строкой — по строке на заголовок, пункт и фразу; текст по строкам не меняется. */
export function structureVacancyText(text: string): string {
  const clean = normalize(text);
  if (!isFlat(clean)) return clean;
  return clean
    .replace(HEADER_BEFORE, '\n')
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ])/u))
    .flatMap(splitListLine)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** Trailing characters of a set, by a loop: `[...]+$` backtracks on a long run inside a line. */
function trimEndOf(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

/** Первая фраза первой строки без поля после тире; длинная — по последнему слову. */
function titleOf(lines: readonly string[]): string {
  const first = lines.find((line) => !COMPANY_LINE.test(line) && !LOCATION_LINE.test(line)) ?? '';
  const phrase = first.split(/\s+[—–|]\s+|(?<=[^\s.]{2})\.\s/u)[0].trim();
  return shortTitle(trimEndOf(phrase, ' .—–|'));
}

function shortTitle(phrase: string): string {
  if (phrase.length <= TITLE_SOFT_MAX) return phrase.slice(0, OWN_VACANCY_TITLE_MAX);
  const cut = phrase.slice(0, TITLE_SOFT_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

function fieldOf(lines: readonly string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const value = pattern.exec(line)?.[1]?.trim();
    const field = value ? trimEndOf(value, ' .;') : '';
    if (field) return field.slice(0, OWN_VACANCY_TITLE_MAX);
  }
  return null;
}

function workFormatOf(text: string, location: string | null): OwnVacancyWorkFormat | null {
  const format = detectVacancyWorkFormat({
    location: location ?? '',
    summary: text,
    isRemote: false,
  });
  // Текст вставил кандидат: признака площадки нет, «офис» и «удалённо» в нём равны — как прежде, офис.
  if (format === 'unknown') return REMOTE.test(text) ? 'remote' : null;
  return format;
}

function isCityPart(part: string): boolean {
  return (
    part.length > 1 &&
    part.length <= CITY_MAX &&
    part.split(/\s+/u).length <= CITY_WORDS_MAX &&
    /^\p{Lu}/u.test(part) &&
    !/\d/u.test(part) &&
    !FORMAT_WORD.test(part)
  );
}

/** Короткая строка «Город, формат»: город — часть без слова формата; иначе города нет. */
function cityFromFormatLine(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (line.length > FORMAT_LINE_MAX || !FORMAT_WORD.test(line)) continue;
    const parts = line
      .split(/\s*[,·|/]\s*|\s+[—–-]\s+/u)
      .map((part) => trimEndOf(part.trim(), ' .;'));
    if (parts.length < 2) continue;
    const city = parts.find(isCityPart);
    if (city) return city;
  }
  return null;
}

export function ownVacancyFromText(text: string): NewOwnVacancy {
  const structured = structureVacancyText(text);
  const lines = structured
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const location = fieldOf(lines, LOCATION_LINE) ?? cityFromFormatLine(lines);
  return {
    title: titleOf(lines),
    company: fieldOf(lines, COMPANY_LINE),
    location,
    workFormat: workFormatOf(structured, location),
    url: null,
    salary: salaryFromText(structured),
    text: structured,
  };
}
