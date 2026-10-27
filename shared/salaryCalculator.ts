/**
 * B569: the public take-home calculator (`/tools/salary-calculator`). Every
 * figure comes from `calculateAnnualPayroll`; the page owns only the choice
 * of countries, defaults, month-by-month Russian withholding and formatting.
 */
import { calculateAnnualPayroll } from './taxCalculators';

export type CalcCountry = 'RU' | 'DE' | 'CY' | 'RS' | 'AE' | 'GE';
export type CalcMode = 'gross' | 'net';

export interface CalcCountryInfo {
  readonly code: CalcCountry;
  readonly label: string;
  readonly symbol: string;
  readonly defaultGross: number;
  readonly note: string;
}

export const CALC_COUNTRIES: readonly CalcCountryInfo[] = [
  {
    code: 'RU',
    label: 'Россия',
    symbol: '₽',
    defaultGross: 300000,
    note: 'Налоговый резидент РФ, без вычетов.',
  },
  {
    code: 'DE',
    label: 'Германия',
    symbol: '€',
    defaultGross: 5000,
    note: 'I налоговый класс, без церковного налога, государственная медстраховка со средней надбавкой 2,9%, без детей.',
  },
  {
    code: 'CY',
    label: 'Кипр',
    symbol: '€',
    defaultGross: 4000,
    note: 'Соцстрахование вычтено из базы, GeSY не вычитается, без индивидуальных вычетов.',
  },
  {
    code: 'RS',
    label: 'Сербия',
    symbol: 'RSD',
    defaultGross: 300000,
    note: 'Штатный работник, без годового налога на высокий доход.',
  },
  {
    code: 'AE',
    label: 'ОАЭ',
    symbol: 'AED',
    defaultGross: 25000,
    note: 'Иностранный работник: налога на доход и взносов нет.',
  },
  {
    code: 'GE',
    label: 'Грузия',
    symbol: '₾',
    defaultGross: 5000,
    note: 'Без накопительной пенсии.',
  },
];

const NBSP = '\u00a0';
export const CALC_PATH = '/tools/salary-calculator';
export const RU_HIGH_RATE_FROM = 2_400_000;
const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

export function calcCountry(code: string): CalcCountryInfo | undefined {
  return CALC_COUNTRIES.find((country) => country.code === code);
}

export function formatCalcMoney(amount: number, symbol: string): string {
  return `${Math.round(amount).toLocaleString('ru-RU')}${NBSP}${symbol}`;
}

function payroll(code: CalcCountry, annualGross: number) {
  return calculateAnnualPayroll(code, annualGross, {
    germanyChildless: true,
    georgiaPensionParticipant: false,
    uaeNational: false,
  });
}

/** Monthly gross that leaves `net` a month after tax, found by bisection. */
export function grossFromNet(code: CalcCountry, net: number): number {
  if (net <= 0) return 0;
  let low = net;
  let high = net * 3;
  while (payroll(code, high * 12).netMonthlyIncome < net && high < 1e10) high *= 2;
  for (let step = 0; step < 50; step += 1) {
    const mid = (low + high) / 2;
    if (payroll(code, mid * 12).netMonthlyIncome < net) low = mid;
    else high = mid;
  }
  return Math.round(high);
}

export interface MonthRow {
  readonly month: string;
  readonly cumulative: number;
  readonly rate: number;
  readonly tax: number;
  readonly net: number;
  readonly raised: boolean;
}

export interface CalcResult {
  readonly country: CalcCountryInfo;
  readonly gross: number;
  readonly netMonthly: number;
  readonly annualTax: number;
  readonly netYear: number;
  /** Russia only: the month the withholding rate first exceeded 13 %. */
  readonly raisedFrom: string | undefined;
  readonly months: readonly MonthRow[];
}

function russianMonths(gross: number): readonly MonthRow[] {
  const taxTo = (cumulative: number) =>
    cumulative <= 0 ? 0 : payroll('RU', cumulative).incomeTax.amount;
  return MONTH_NAMES.map((month, index) => {
    const cumulative = gross * (index + 1);
    const tax = taxTo(cumulative) - taxTo(cumulative - gross);
    const edge = taxTo(cumulative) - taxTo(cumulative - 1);
    const rate = Math.round(edge * 100);
    return { month, cumulative, rate, tax, net: gross - tax, raised: rate > 13 };
  });
}

export function calculateSalary(code: CalcCountry, amount: number, mode: CalcMode): CalcResult {
  const country = calcCountry(code) ?? CALC_COUNTRIES[0];
  const gross = mode === 'gross' ? amount : grossFromNet(country.code, amount);
  const result = payroll(country.code, gross * 12);
  const months = country.code === 'RU' ? russianMonths(gross) : [];
  const annualTax = gross * 12 - result.netAnnualIncome;
  return {
    country,
    gross,
    netMonthly: result.netMonthlyIncome,
    annualTax,
    netYear: result.netAnnualIncome,
    raisedFrom: months.find((row) => row.raised)?.month,
    months,
  };
}

export const CALC_QUICK_AMOUNTS: readonly number[] = [100000, 150000, 250000, 300000];

export interface CalcQuery {
  readonly country: CalcCountry;
  readonly mode: CalcMode;
  readonly amount: number;
}

export function parseCalcQuery(search: string): Partial<CalcQuery> {
  const params = new URLSearchParams(search);
  const country = calcCountry(params.get('country') ?? '')?.code;
  const mode = params.get('mode');
  const amount = Number.parseInt(params.get('amount') ?? '', 10);
  return {
    ...(country ? { country } : {}),
    ...(mode === 'net' || mode === 'gross' ? { mode } : {}),
    ...(amount > 0 && amount < 1e9 ? { amount } : {}),
  };
}

export function calcQueryString(query: CalcQuery): string {
  return `?country=${query.country}&amount=${query.amount}&mode=${query.mode}`;
}

/** The catalog link for the result: vacancies paying at least the gross. */
export function calcCatalogHref(result: CalcResult): string {
  const country = result.country.code === 'RU' ? '' : `&country=${result.country.code}`;
  return `/vacancies?salary_from=${Math.round(result.gross)}${country}`;
}
