import { convertAmount, type CurrencyRates } from './currencyRates';

/** Вход перевода: поля зарплаты вакансии, общие для сервера и клиента. */
export interface SalaryAmounts {
  readonly from?: number;
  readonly to?: number;
  readonly currency?: string;
  readonly period?: string;
}

/**
 * Вилка роли считалась только по рублям (28.10): у VP of Engineering, CIO,
 * Head of AI зарплаты в пуле есть, но в USD и EUR, и роль показывала «вилка не
 * считается» при десятках вакансий. Сумма переводится в рубли в месяц по курсу
 * ЦБ; почасовые ставки и валюты без курса в вилку не входят.
 */

/** Иностранная сумма без периода от этого порога — годовая (225 000 USD, 90 000 EUR). */
const YEARLY_WITHOUT_PERIOD = 20_000;
/** …если это не 800 000 тенге: месячная сумма в слабой валюте тоже больше порога (04.11). */
const YEARLY_WITHOUT_PERIOD_RUB = 1_000_000;
const MONTHS = 12;

function isRuble(currency: string): boolean {
  return ['RUR', 'RUB', '₽'].includes(currency.trim().toUpperCase());
}

/**
 * B765: в каком периоде указана сумма — одно правило для сервера и клиента. Без периода
 * крупная иностранная сумма — годовая; почасовая ставка в месячную сумму не переводится.
 */
export function salaryPeriodOf(
  salary: SalaryAmounts,
  rates: CurrencyRates | undefined,
): 'hour' | 'month' | 'year' {
  if (salary.period === 'hour') return 'hour';
  if (salary.period === 'year') return 'year';
  const currency = salary.currency ?? 'RUR';
  const amounts = [salary.from, salary.to].filter((value): value is number => Boolean(value));
  if (salary.period || isRuble(currency) || amounts.length === 0) return 'month';
  const largest = Math.max(...amounts);
  const yearly =
    largest >= YEARLY_WITHOUT_PERIOD &&
    (convertAmount(largest, currency, 'RUB', rates) ?? 0) >= YEARLY_WITHOUT_PERIOD_RUB;
  return yearly ? 'year' : 'month';
}

/** Сумма в месяц в валюте вакансии; у почасовой ставки месячной суммы нет. */
export function monthlyAmount(
  amount: number | undefined,
  period: 'hour' | 'month' | 'year',
): number | undefined {
  if (!amount || period === 'hour') return undefined;
  return period === 'year' ? amount / MONTHS : amount;
}

export function monthlyRubSalary(
  salary: SalaryAmounts,
  rates: CurrencyRates | undefined,
): { from?: number; to?: number; currency: 'RUB' } | undefined {
  const currency = salary.currency ?? 'RUR';
  const amounts = [salary.from, salary.to].filter((value): value is number => Boolean(value));
  const period = salaryPeriodOf(salary, rates);
  if (amounts.length === 0 || period === 'hour') return undefined;
  const monthly = (amount: number | undefined): number | undefined => {
    const perMonth = monthlyAmount(amount, period);
    if (perMonth === undefined) return undefined;
    const rub = convertAmount(perMonth, currency, 'RUB', rates);
    return rub === undefined ? undefined : Math.round(rub);
  };
  const from = monthly(salary.from);
  const to = monthly(salary.to);
  if (from === undefined && to === undefined) return undefined;
  return {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    currency: 'RUB',
  };
}
