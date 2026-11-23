import { createHash } from 'node:crypto';
import { pluralWordRu } from '../../shared/pluralRu';

/**
 * B671 (n01b): «Новые вакансии по вашей роли» — одна запись на роль в сутки. Следующий
 * набор того же дня дописывается в неё: в `source_id` хранятся короткие отпечатки
 * вакансий дня (не текст вакансий), число в заголовке — сколько их.
 */
export const ROLE_DIGEST_SOURCE_TYPE = 'matched_vacancy_day';
/** Сутки уведомления — по московскому календарю: аудитория кабинета в основном там. */
export const ROLE_DIGEST_TIME_ZONE = 'Europe/Moscow';
const MARK_LENGTH = 10;
const MAX_MARKS = 400;
const SEPARATOR = ',';

function shortHash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

/** «2026-11-23» в часовом поясе суток уведомления. */
export function digestDay(now: Date, timeZone = ROLE_DIGEST_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(now);
}

/** Ключ записи: день и набор ролей поиска — смена ролей начинает свою запись. */
export function roleDigestKey(day: string, roles: readonly string[]): string {
  const roleSet = [...roles]
    .map((role) => role.trim().toLowerCase())
    .sort()
    .join('\0');
  return `new-vacancies:${day}:${shortHash(roleSet, 12)}`;
}

function marksOf(sourceId: string): string[] {
  return sourceId.split(SEPARATOR).filter((mark) => /^[0-9a-f]+$/u.test(mark));
}

/** Объединение отпечатков дня с новым набором; уже учтённые вакансии не считаются дважды. */
export function mergeDigestMarks(stored: string, vacancyIds: readonly string[]): string {
  const marks = new Set(marksOf(stored));
  for (const id of vacancyIds) {
    if (marks.size >= MAX_MARKS) break;
    marks.add(shortHash(id, MARK_LENGTH));
  }
  return [...marks].join(SEPARATOR);
}

export function digestCount(sourceType: string, sourceId: string): number | null {
  if (sourceType !== ROLE_DIGEST_SOURCE_TYPE) return null;
  const count = marksOf(sourceId).length;
  return count > 0 ? count : null;
}

const CONSONANT_END = /[бвгджзклмнпрстфхцчшщ]$/u;

/** Несклоняемая первая часть: «вице-президента», «бизнес-аналитика». */
const FIXED_PREFIXES = new Set([
  'вице',
  'бизнес',
  'контент',
  'продукт',
  'проджект',
  'веб',
  'бренд',
  'арт',
  'шеф',
]);

type Declined = { readonly form: string; readonly noun: boolean } | null;

/** Слово через дефис склоняется по второй части, только если первая не меняется. */
function genitiveWord(word: string): Declined {
  const lower = word.toLowerCase();
  const parts = lower.split('-');
  if (parts.length === 1) return genitiveSimple(lower);
  if (parts.length !== 2 || !FIXED_PREFIXES.has(parts[0]!)) return null;
  const tail = genitiveSimple(parts[1]!);
  return tail ? { form: `${parts[0]}-${tail.form}`, noun: tail.noun } : null;
}

/** Родительный падеж одного слова до первого существительного; `null` — не знаем. */
function genitiveSimple(lower: string): Declined {
  if (/(ый|ой)$/u.test(lower)) return { form: `${lower.slice(0, -2)}ого`, noun: false };
  if (/[гкх]ий$/u.test(lower)) return { form: `${lower.slice(0, -2)}ого`, noun: false };
  if (/[жшчщн]ий$/u.test(lower)) return { form: `${lower.slice(0, -2)}его`, noun: false };
  if (/[ьй]$/u.test(lower)) return { form: `${lower.slice(0, -1)}я`, noun: true };
  if (/[^аеёиоуыэюя]ец$/u.test(lower)) return { form: `${lower.slice(0, -2)}ца`, noun: true };
  if (CONSONANT_END.test(lower)) return { form: `${lower}а`, noun: true };
  return null;
}

/**
 * «Руководитель разработки» → «руководителя разработки», «Технический директор» →
 * «технического директора». Склоняются слова до первого существительного; остальное
 * («по продукту», «разработки») не меняется. Латиница и незнакомые окончания — `null`.
 */
export function roleGenitiveRu(role: string): string | null {
  const words = role.trim().split(/\s+/u);
  if (!words[0] || !/^[А-ЯЁа-яё-]+$/u.test(words[0])) return null;
  const out: string[] = [];
  for (let index = 0; index < words.length && index < 3; index += 1) {
    const word = words[index]!;
    if (!/^[А-ЯЁа-яё-]+$/u.test(word)) return null;
    const declined = genitiveWord(word);
    if (!declined) return null;
    out.push(declined.form);
    if (declined.noun) return [...out, ...words.slice(index + 1)].join(' ');
  }
  return null;
}

/** «6 новых вакансий руководителя разработки»; без падежа роли — «по вашей роли». */
export function roleDigestTitle(count: number, roles: readonly string[]): string {
  const vacancies = `${count} ${pluralWordRu(count, ['новая вакансия', 'новые вакансии', 'новых вакансий'])}`;
  const genitive = roles.length === 1 ? roleGenitiveRu(roles[0]!) : null;
  if (genitive) return `${vacancies} ${genitive}`;
  return `${vacancies} ${roles.length > 1 ? 'по вашим ролям' : 'по вашей роли'}`;
}

/** Роль в подписи не нужна, когда она уже стоит в заголовке. */
export function roleInDigestTitle(roles: readonly string[]): boolean {
  return roles.length === 1 && roleGenitiveRu(roles[0]!) !== null;
}
