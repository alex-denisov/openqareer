import type { VacancySalary } from '../domain/unifiedVacancy';

/**
 * Н3 (25.11): вилка, названная только в тексте вакансии («Pay Range $240,000–280,000»). Читается
 * одна вилка рядом со словом о зарплате; несколько разных вилок (по городам или уровням), ставка
 * в час и бонусы не читаются: угадывать нечего. Период текст чаще не называет — его решает
 * общее правило `salaryPeriodOf`.
 */
const KEYWORD =
  /(?:(?:pay|salary|compensation|base)\s+(?:range|band)|base\s+(?:pay|salary|compensation)|annual\s+(?:pay|salary)|salary)(?:[^.!?$€£]|\.(?!\s)){0,80}$/iu;
const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{2,3}(?:\.\d)?\s?[kK](?![\p{L}])`;
const RANGE = new RegExp(
  String.raw`(?<![\p{L}$€£])(?<sign>US\$|[$€£])\s?(?<from>${AMOUNT})\s*(?:USD|EUR|GBP)?\s*(?:[-–—]|to|and)\s*(?:US)?[$€£]?\s?(?<to>${AMOUNT})(?=(?<after>[^\n]{0,40}))`,
  'giu',
);
const CURRENCIES: Readonly<Record<string, string>> = {
  $: 'USD',
  US$: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};
const OTHER_CURRENCY = /\b(?:CAD|AUD|NZD|SGD|HKD|MXN|BRL)\b/u;
const NOT_YEARLY = /^\s*(?:(?:USD|EUR|GBP)\s*)?(?:\/|per\s|an?\s)\s*(?:hour|hr|day|week|month)/iu;
/** «$175,760 - $197,004 - $221,970»: три числа — не вилка. */
const THIRD_AMOUNT = /^\s*[-–—]\s*[$€£]?\s?\d/u;
const NOT_BASE = /\b(?:OTE|on[- ]target|bonus|equity|sign-on)\b/iu;
/** Знак «$» без кода у вакансии в этих местах — не обязательно доллар США. */
const OTHER_DOLLAR =
  /\b(?:canad\w*|ontario|ottawa|toronto|vancouver|montr[eé]al|calgary|edmonton|winnipeg|qu[eé]bec|alberta|british columbia|austral\w*|sydney|melbourne|brisbane|perth|new zealand|auckland|singapore|hong kong|taiwan|mexico)\b/iu;
const MIN_AMOUNT = 20_000;
const MAX_SPREAD = 3;
const KEYWORD_WINDOW = 120;

function amountOf(text: string): number {
  const thousands = /k$/iu.test(text);
  const value = Number(text.replace(/[\s,k]/giu, ''));
  return thousands ? value * 1000 : value;
}

function plain(text: string): string {
  return text
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;|\u00a0/gu, ' ')
    .replace(/&(?:ndash|mdash|#8211|#8212);/gu, '–')
    .replace(/[*_]+/gu, '')
    .replace(/[ \t]+/gu, ' ');
}

function salaryOf(match: RegExpExecArray, before: string): VacancySalary | null {
  const { sign = '', from = '', to = '', after = '' } = match.groups ?? {};
  const keyword = KEYWORD.exec(before)?.[0];
  if (!keyword || NOT_BASE.test(keyword)) return null;
  if (NOT_YEARLY.test(after) || THIRD_AMOUNT.test(after)) return null;
  if (OTHER_CURRENCY.test(`${keyword} ${after}`)) return null;
  const low = amountOf(from);
  const high = amountOf(to);
  if (low < MIN_AMOUNT || high <= low || high > low * MAX_SPREAD) return null;
  const currency = CURRENCIES[sign.toUpperCase()];
  return currency ? { from: low, to: high, currency } : null;
}

export function salaryFromDescription(description: string): VacancySalary | undefined {
  if (!/[$€£]/u.test(description)) return undefined;
  const text = plain(description);
  const found = new Map<string, VacancySalary>();
  for (const match of text.matchAll(RANGE)) {
    const before = text.slice(Math.max(0, match.index - KEYWORD_WINDOW), match.index);
    const salary = salaryOf(match, before);
    // Вторая сумма в другой форме («…, and can increase up to $172,500 - $182,500») — уже не одна вилка.
    found.set(`${match.groups?.from}-${match.groups?.to}`, salary ?? {});
  }
  const [only] = found.values();
  return found.size === 1 && only?.currency ? only : undefined;
}

/** Вилка площадки важнее текста; без неё — вилка из текста. */
export function withTextSalary<
  T extends {
    readonly title?: string;
    readonly location?: string;
    readonly salary?: VacancySalary;
    readonly description: string;
    readonly fullDescription?: string;
  },
>(vacancy: T): T {
  if (vacancy.salary?.from !== undefined || vacancy.salary?.to !== undefined) return vacancy;
  const salary = salaryFromDescription(
    vacancy.fullDescription?.trim() || vacancy.description || '',
  );
  if (
    salary?.currency === 'USD' &&
    OTHER_DOLLAR.test(`${vacancy.title ?? ''} ${vacancy.location ?? ''}`)
  )
    return vacancy;
  return salary ? { ...vacancy, salary } : vacancy;
}
