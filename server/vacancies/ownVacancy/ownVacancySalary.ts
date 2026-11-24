import type { OwnVacancySalary } from '../../../shared/b640OwnVacancy';
import { record } from '../jsonVacancyRecord';

/**
 * B676: деньги своей вакансии — из `baseSalary` JSON-LD или из одной строки зарплаты в тексте.
 * Сумма хранится как в вакансии (валюта, период); перевод в месяц и в валюту подборки делают
 * общие правила списка (`salaryPeriodOf`, `monthlyAmount`, `meetsMonthlySalaryMinimum`).
 *
 * Строка зарплаты — со словом о зарплате или с вилкой в валюте: первая сумма текста бывает
 * чем угодно («$250 Annual Stipend», прод 23.11).
 */
const LINE_MAX = 200;
const KEYWORD =
  /зарплат|заработн|оклад|доход|вознагражд|компенсац|з\/п|salary|compensation|pay range|base pay|wage/iu;
const CURRENCIES: readonly (readonly [RegExp, string])[] = [
  [/₽|руб|\brub\b|\brur\b/iu, 'RUB'],
  [/\$|\busd\b/iu, 'USD'],
  [/€|\beur\b/iu, 'EUR'],
  [/£|\bgbp\b/iu, 'GBP'],
  [/₸|\bkzt\b|тенге/iu, 'KZT'],
];
const PERIODS: readonly (readonly [RegExp, NonNullable<OwnVacancySalary['period']>])[] = [
  [/в час|per hour|an hour|hourly|\/\s*h(?:ou)?r\b/iu, 'hour'],
  [/в месяц|per month|a month|monthly|ежемесячн|\/\s*mo(?:nth)?\b/iu, 'month'],
  [/в год|per year|a year|per annum|annual|годов|\/\s*y(?:ea)?r\b/iu, 'year'],
];
const AMOUNT = /(\d{1,3}(?:[\s,.]\d{3})+|\d+)(\s*(?:k|к|тыс\.?)(?![a-zа-яё]))?/giu;
const RANGE = /\d\s*(?:k|к|тыс\.?)?\s*(?:[-–—]|до|to)\s*[$€£₽]?\s*\d/iu;
const UPTO = /(?:^|[\s:])(?:до|up to)\s*[$€£₽]?\s*\d/iu;

interface Amount {
  readonly value: number;
  readonly thousands: boolean;
}

function currencyOf(line: string): string | null {
  return CURRENCIES.find(([pattern]) => pattern.test(line))?.[1] ?? null;
}

function periodOf(line: string): OwnVacancySalary['period'] {
  return PERIODS.find(([pattern]) => pattern.test(line))?.[1];
}

function amountsOf(line: string): Amount[] {
  return [...line.matchAll(AMOUNT)].map((match) => ({
    value: Number(match[1].replace(/[\s,.]/gu, '')),
    thousands: Boolean(match[2]),
  }));
}

/** «300–400 тыс.»: тысячи у второй суммы относятся и к первой. */
function scaled(amounts: readonly Amount[]): number[] {
  const shared = amounts.length === 2 && amounts[1].thousands && amounts[0].value < 1000;
  return amounts.map((item) => (item.thousands || shared ? item.value * 1000 : item.value));
}

function withPeriod(
  salary: OwnVacancySalary,
  period: OwnVacancySalary['period'],
): OwnVacancySalary {
  return period ? { ...salary, period } : salary;
}

function salaryOfLine(line: string): OwnVacancySalary | null {
  const currency = currencyOf(line);
  if (!currency || line.length > LINE_MAX) return null;
  const range = RANGE.test(line);
  if (!range && !KEYWORD.test(line)) return null;
  const values = scaled(amountsOf(line)).filter((value) => value > 0);
  if (values.length === 0) return null;
  const period = periodOf(line);
  if (range && values.length >= 2)
    return withPeriod({ from: values[0], to: values[1], currency }, period);
  const single = UPTO.test(line) ? { to: values[0], currency } : { from: values[0], currency };
  return withPeriod(single, period);
}

export function salaryFromText(text: string): OwnVacancySalary | null {
  for (const line of text.split('\n')) {
    const salary = salaryOfLine(line.trim());
    if (salary) return salary;
  }
  return null;
}

const LD_PERIODS: Readonly<Record<string, NonNullable<OwnVacancySalary['period']>>> = {
  HOUR: 'hour',
  MONTH: 'month',
  YEAR: 'year',
};

function positive(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined;
}

/** `baseSalary` JobPosting: MonetaryAmount с `value` — QuantitativeValue или число. */
export function salaryFromJsonLd(baseSalary: unknown): OwnVacancySalary | null {
  const amount = record(Array.isArray(baseSalary) ? baseSalary[0] : baseSalary);
  const currency = typeof amount.currency === 'string' ? amount.currency.trim().toUpperCase() : '';
  if (!currency) return null;
  const value = record(amount.value);
  const from = positive(value.minValue) ?? positive(value.value) ?? positive(amount.value);
  const to = positive(value.maxValue);
  if (from === undefined && to === undefined) return null;
  const unit = typeof value.unitText === 'string' ? value.unitText.trim().toUpperCase() : '';
  const salary: OwnVacancySalary = {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined && to !== from ? { to } : {}),
    currency,
  };
  return withPeriod(salary, LD_PERIODS[unit]);
}
