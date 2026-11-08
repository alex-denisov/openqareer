/** GEO 09.11: monthly vacancy market report — shared shape and addresses. */

export const MARKET_REPORTS_ROOT = '/reports';
export const MARKET_REPORT_PREFIX = 'rynok-vakansiy-';
/** A figure from fewer observations is an anecdote; it is not printed. */
export const MIN_REPORT_SAMPLE = 5;

export interface MarketReportSalaryGroup {
  readonly currency: string;
  readonly period: 'hour' | 'month' | 'year';
  readonly sample: number;
  readonly medianLow: number;
  readonly medianHigh: number;
}

export interface MarketReportRole {
  readonly slug: string;
  readonly label: string;
  readonly count: number;
}

export interface MarketReport {
  /** `YYYY-MM` */
  readonly month: string;
  /** `YYYY-MM-DD` — date of computation. */
  readonly generatedAt: string;
  /** Deduplicated vacancies (clusters) first published in the month. */
  readonly vacancies: number;
  /** Source records behind them; one vacancy may appear on several boards. */
  readonly sourceRecords: number;
  /** Remote vacancies; absent when the month is below the sample floor. */
  readonly remote?: number;
  readonly withPeriodisedRange: number;
  readonly salaryGroups: readonly MarketReportSalaryGroup[];
  /** Currency+period groups not printed: sample below MIN_REPORT_SAMPLE. */
  readonly hiddenSalaryGroups: number;
  readonly topRoles: readonly MarketReportRole[];
}

const MONTHS_PREPOSITIONAL = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
];

export function isReportMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(value);
}

export function marketReportPath(month: string): string {
  return `${MARKET_REPORTS_ROOT}/${MARKET_REPORT_PREFIX}${month}`;
}

/** «в октябре 2026» */
export function monthPhrase(month: string): string {
  const [year, mon] = month.split('-');
  return `в ${MONTHS_PREPOSITIONAL[Number(mon) - 1]} ${year}`;
}

export function marketReportTitle(month: string): string {
  return `Рынок вакансий ${monthPhrase(month)}: число, зарплаты, удалёнка`;
}

/** «2026-10-01»…«2026-10-31» */
export function monthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}
