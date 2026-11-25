import { formatMarketSalaryRange, marketSalaryLabel } from '../../../../../shared/marketSalaryEstimate';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { formatStatedCompensation } from '../../../vacancies/vacancyCompensation';
import { moneyView, type MoneyCurrency } from '../format';

const TARGETS: readonly MoneyCurrency[] = ['RUB', 'USD', 'EUR', 'AED', 'ORIG'];

/** B593: валюта, в которой показываем суммы: выбор в «Приложении», затем валюта условий, иначе рубли. */
export function targetMoneyCurrency(preferred: string | null, conditions: string | undefined): MoneyCurrency {
  const code = (preferred ?? conditions)?.toUpperCase();
  return TARGETS.find((value) => value === code) ?? 'RUB';
}

export interface MoneyLines {
  /** Крупная сумма. */
  readonly big: string;
  readonly small: string;
  /** «в вакансии 5–6,5 тыс. $, курс ЦБ на 10.11» — только у пересчитанных денег. */
  readonly converted?: string;
  /** Текст ⓘ: откуда число. */
  readonly tip: string;
}

function ratesDate(rates: CurrencyRates): string {
  const [, month, day] = rates.date.split('-');
  return `${day}.${month}`;
}

function hasMarket(item: MatchedVacancyItem): boolean {
  const market = item.explanation.marketSalary;
  return market !== undefined;
}

function marketLines(item: MatchedVacancyItem): MoneyLines | null {
  const market = item.explanation.marketSalary;
  if (!market) return null;
  const range = formatMarketSalaryRange({ low: market.low, high: market.high, currency: market.currency });
  return {
    big: range,
    small: 'Оценка openqareer',
    tip: `${marketSalaryLabel(market.computedAt)}: ${range}.`,
  };
}

/** Деньги карточки: сумма вакансии (при необходимости пересчитанная) или оценка рынка. */
export function moneyLines(
  item: MatchedVacancyItem,
  rates: CurrencyRates | undefined,
  currency: MoneyCurrency,
): MoneyLines | null {
  const salary = item.cluster.salary;
  if (!salary || (salary.from === undefined && salary.to === undefined)) return marketLines(item);
  const view = moneyView(item, { currency, rates });
  const converted = view.title && rates ? `в вакансии ${formatStatedCompensation(salary, rates)}, курс ЦБ на ${ratesDate(rates)}` : undefined;
  const parts = [
    hasMarket(item) ? marketLines(item)!.tip : 'Вилка — из текста вакансии.',
    ...(converted && rates ? [`Пересчёт валют — по курсу ЦБ на ${ratesDate(rates)}.`] : []),
  ];
  return { big: view.text, small: 'в вакансии', ...(converted ? { converted } : {}), tip: parts.join(' ') };
}
