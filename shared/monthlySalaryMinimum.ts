import { convertAmount, type CurrencyRates } from './currencyRates';
import { monthlyAmount, salaryPeriodOf, type SalaryAmounts } from './monthlyRubSalary';

/**
 * Фильтр «Зарплата от» списка вакансий: верхняя граница вилки в месяц, в валюте порога по курсу ЦБ,
 * не ниже порога. Строка без месячной суммы (нет суммы, ставка в час, период неизвестен, нет курса)
 * остаётся в списке как «не указана» (B645 s07). Одно правило для клиента и для числа сервера.
 */
export function meetsMonthlySalaryMinimum(
  salary: SalaryAmounts | undefined,
  minimum: number,
  currency: string,
  rates: CurrencyRates | undefined,
): boolean {
  if (!salary) return true;
  const period = salaryPeriodOf(salary, rates);
  const upper = monthlyAmount(salary.to ?? salary.from, period);
  if (upper === undefined || salary.currency === undefined) return true;
  const converted = convertAmount(upper, salary.currency, currency, rates);
  return converted === undefined || converted >= minimum;
}
