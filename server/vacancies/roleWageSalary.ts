import { convertAmount, type CurrencyRates } from '../../shared/currencyRates';
import type { VacancySalary } from '../domain/unifiedVacancy';

/**
 * Вилка роли считалась только по рублям (28.10): у VP of Engineering, CIO,
 * Head of AI зарплаты в пуле есть, но в USD и EUR, и роль показывала «вилка не
 * считается» при десятках вакансий. Сумма переводится в рубли в месяц по курсу
 * ЦБ; почасовые ставки и валюты без курса в вилку не входят.
 */

/** Иностранная сумма без периода от этого порога — годовая (225 000 USD, 90 000 EUR). */
const YEARLY_WITHOUT_PERIOD = 20_000;
const MONTHS = 12;

function isRuble(currency: string): boolean {
  return ['RUR', 'RUB', '₽'].includes(currency.trim().toUpperCase());
}

export function monthlyRubSalary(
  salary: VacancySalary,
  rates: CurrencyRates | undefined,
): { from?: number; to?: number; currency: 'RUB' } | undefined {
  const currency = salary.currency ?? 'RUR';
  const amounts = [salary.from, salary.to].filter((value): value is number => Boolean(value));
  if (amounts.length === 0 || salary.period === 'hour') return undefined;
  const ruble = isRuble(currency);
  const yearly =
    salary.period === 'year' ||
    (!ruble && !salary.period && Math.max(...amounts) >= YEARLY_WITHOUT_PERIOD);
  const monthly = (amount: number | undefined): number | undefined => {
    if (!amount) return undefined;
    const rub = convertAmount(amount, currency, 'RUB', rates);
    return rub === undefined ? undefined : Math.round(yearly ? rub / MONTHS : rub);
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
