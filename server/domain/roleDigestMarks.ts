import { createHash } from 'node:crypto';
import { convertAmount, type CurrencyRates } from '../../shared/currencyRates';
import { monthlyAmount, salaryPeriodOf, type SalaryAmounts } from '../../shared/monthlyRubSalary';

/**
 * B671 (n01b): содержимое `source_id` записи «Новые вакансии по вашей роли» за сутки —
 * «порог|отпечатки». Отпечаток — 10 знаков хэша вакансии, «+» — вакансия на момент записи
 * была выше порога зарплаты кандидата. Порог — условие кандидата («Зарплата от» в его
 * решениях), не наша оценка рынка; «*» — порог менялся за день, подписи нет.
 */
export const ROLE_DIGEST_SOURCE_TYPE = 'matched_vacancy_day';
const MARK_LENGTH = 10;
const MAX_MARKS = 400;
const MIXED_FLOOR = '*';
const MARK = /^([0-9a-f]+)(\+?)$/u;

export interface DigestFloor {
  readonly amount: number;
  readonly currency: string;
}

export interface DigestVacancy {
  readonly id: string;
  readonly aboveFloor: boolean;
}

interface ParsedMarks {
  readonly floor: string;
  readonly marks: ReadonlyMap<string, boolean>;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, MARK_LENGTH);
}

function floorTag(floor: DigestFloor | null): string {
  return floor ? `${Math.round(floor.amount)}:${floor.currency.toUpperCase()}` : '';
}

function parse(sourceId: string): ParsedMarks {
  const split = sourceId.lastIndexOf('|');
  const floor = split < 0 ? '' : sourceId.slice(0, split);
  const marks = new Map<string, boolean>();
  for (const token of sourceId.slice(split + 1).split(',')) {
    const match = MARK.exec(token);
    if (match) marks.set(match[1]!, match[2] === '+');
  }
  return { floor, marks };
}

function serialize({ floor, marks }: ParsedMarks): string {
  const tokens = Array.from(marks, ([mark, above]) => (above ? `${mark}+` : mark));
  return `${floor}|${tokens.join(',')}`;
}

/**
 * Объединение вакансий дня с новым набором: уже учтённые не считаются дважды. Без новых
 * вакансий возвращает `stored` как есть — запись не меняется.
 */
export function mergeDigestMarks(
  stored: string,
  vacancies: readonly DigestVacancy[],
  floor: DigestFloor | null = null,
): string {
  const parsed = parse(stored);
  const marks = new Map(parsed.marks);
  for (const vacancy of vacancies) {
    if (marks.size >= MAX_MARKS) break;
    const mark = shortHash(vacancy.id);
    if (!marks.has(mark)) marks.set(mark, floor !== null && vacancy.aboveFloor);
  }
  if (marks.size === parsed.marks.size) return stored;
  const tag = floorTag(floor);
  const sameFloor = parsed.marks.size === 0 || parsed.floor === tag;
  return serialize({ floor: sameFloor ? tag : MIXED_FLOOR, marks });
}

export function digestCount(sourceType: string, sourceId: string): number | null {
  if (sourceType !== ROLE_DIGEST_SOURCE_TYPE) return null;
  const count = parse(sourceId).marks.size;
  return count > 0 ? count : null;
}

const CURRENCY_PREFIX: Readonly<Record<string, string>> = { USD: '$', EUR: '€', GBP: '£' };

/** «450 тыс. ₽», «$5 тыс.». */
function floorLabel(amount: number, currency: string): string {
  const thousands = String(Math.round(amount / 1_000));
  if (currency === 'RUB' || currency === 'RUR') return `${thousands} тыс. ₽`;
  const prefix = CURRENCY_PREFIX[currency];
  return prefix ? `${prefix}${thousands} тыс.` : `${thousands} тыс. ${currency}`;
}

/** Подпись по макету n01b: «выше 450 тыс. ₽»; выше порога не все — «4 выше …»; иначе ничего. */
export function digestSalaryNote(sourceType: string, sourceId: string): string | null {
  if (sourceType !== ROLE_DIGEST_SOURCE_TYPE) return null;
  const { floor, marks } = parse(sourceId);
  const match = /^(\d+):([A-Z]{3})$/u.exec(floor);
  if (!match) return null;
  const above = [...marks.values()].filter(Boolean).length;
  if (above === 0) return null;
  const label = floorLabel(Number(match[1]), match[2]!);
  return above === marks.size ? `выше ${label}` : `${above} выше ${label}`;
}

/** Вилка известна и её верх в месяц не ниже порога; неизвестная сумма порог не проходит. */
export function salaryAboveFloor(
  salary: SalaryAmounts | undefined,
  floor: DigestFloor,
  rates: CurrencyRates | undefined,
): boolean {
  if (!salary?.currency) return false;
  const upper = monthlyAmount(salary.to ?? salary.from, salaryPeriodOf(salary, rates));
  if (upper === undefined) return false;
  const converted = convertAmount(upper, salary.currency, floor.currency, rates);
  return converted !== undefined && converted >= floor.amount;
}
