import { convertAmount, type CurrencyRates } from '../../../../../shared/currencyRates';
import { formatMarketSalaryRange } from '../../../../../shared/marketSalaryEstimate';
import { monthlySalary } from '../../../../../shared/monthlyRubSalary';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { moneyScale, type Expectation } from '../card/moneyScale';
import { moneyView, type MoneyOptions } from '../format';

/** Сумма строки «Деньги»: из вакансии, иначе оценка рынка числом. */
export function detailMoneyText(item: MatchedVacancyItem, options: MoneyOptions): string {
  const { text } = moneyView(item, options);
  if (text !== 'не указана') return text;
  const market = item.explanation.marketSalary;
  if (market?.low === undefined || market.high === undefined) return 'не указаны';
  return formatMarketSalaryRange({
    low: market.low,
    high: market.high,
    currency: market.currency,
  });
}

const VERDICTS = { below: 'ниже', inside: 'внутри', above: 'выше' } as const;

/** «ожидания внутри вилки»; нет ожиданий или сравнить не с чем — `undefined`. */
export function expectationCaption(
  item: MatchedVacancyItem,
  rates: CurrencyRates | undefined,
  expectation: Expectation | undefined,
): string | undefined {
  const salary = monthlySalary(item.cluster.salary, rates);
  const scale = moneyScale(item.explanation.marketSalary, salary, rates, expectation);
  if (!scale?.verdict) return undefined;
  const against = scale.verdictAgainst === 'fork' ? 'вилки' : 'оценки';
  return `ожидания ${VERDICTS[scale.verdict]} ${against}`;
}

/** Место ожиданий на оси полосы, %; валюта без курса — `undefined`. */
export function expectationMark(
  axis: { readonly top: number; readonly currency: string },
  rates: CurrencyRates | undefined,
  expectation: Expectation | undefined,
): number | undefined {
  if (!expectation) return undefined;
  const amount = convertAmount(expectation.amount, expectation.currency, axis.currency, rates);
  return amount === undefined ? undefined : Math.min((amount / axis.top) * 100, 100);
}
