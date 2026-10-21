import { ChartBar } from '@phosphor-icons/react';

import { formatMarketSalaryRange, marketSalaryBasis } from '../../../shared/marketSalaryEstimate';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { formatCompensationCompact } from './vacancyCompensation';

type MarketSalary = NonNullable<MatchedVacancyItem['explanation']['marketSalary']>;

function StatedOrMissing({
  item,
  sourceLine,
}: {
  readonly item: MatchedVacancyItem;
  readonly sourceLine: string;
}) {
  const stated = Boolean(item.cluster.salary);
  return (
    <>
      <span className="career-numeric vacancy-screen-money-value">
        {stated ? (
          formatCompensationCompact(item.cluster.salary)
        ) : (
          <>
            <span className="vacancy-screen-money-wide">не указана</span>
            <span className="vacancy-screen-money-narrow">без зарплаты</span>
          </>
        )}
      </span>
      <span className="vacancy-screen-money-source">
        {stated ? 'указана в вакансии' : 'зарплата не указана'} · {sourceLine}
      </span>
    </>
  );
}

function ThinSample({ estimate }: { readonly estimate: MarketSalary }) {
  return (
    <>
      <span className="career-numeric vacancy-screen-money-value">
        <span className="vacancy-screen-money-wide">мало данных</span>
        <span className="vacancy-screen-money-narrow">без зарплаты</span>
      </span>
      <span className="vacancy-screen-money-source is-estimate">
        нет зарплаты, оценка {marketSalaryBasis(estimate.sampleSize, estimate.computedAt)}
      </span>
    </>
  );
}

function MarketEstimate({
  estimate,
  low,
  high,
}: {
  readonly estimate: MarketSalary;
  readonly low: number;
  readonly high: number;
}) {
  return (
    <>
      <span className="career-numeric vacancy-screen-money-value">
        {formatMarketSalaryRange({ low, high, currency: estimate.currency })}
        <span className="vacancy-screen-money-narrow vacancy-screen-money-short">оценка</span>
      </span>
      <span className="vacancy-screen-money-source is-estimate">
        <span className="vacancy-screen-money-tag">
          <ChartBar aria-hidden="true" />
          оценка рынка
        </span>
        <span>{marketSalaryBasis(estimate.sampleSize, estimate.computedAt)}</span>
      </span>
    </>
  );
}

/**
 * «Деньги» (B546): the stated salary, the market estimate for a vacancy
 * without one, or an honest «мало данных». An estimate never appears
 * without its sample size and the date of the cut.
 */
function MoneyContent({
  item,
  sourceLine,
}: {
  readonly item: MatchedVacancyItem;
  readonly sourceLine: string;
}) {
  const estimate = item.explanation.marketSalary;
  if (item.cluster.salary || !estimate)
    return <StatedOrMissing item={item} sourceLine={sourceLine} />;
  if (estimate.low === undefined || estimate.high === undefined) {
    return <ThinSample estimate={estimate} />;
  }
  return <MarketEstimate estimate={estimate} low={estimate.low} high={estimate.high} />;
}

export function VacancyMoneyCell({
  item,
  observedDate,
}: {
  readonly item: MatchedVacancyItem;
  readonly observedDate: string | undefined;
}) {
  const source = vacancySourceLabels(item.cluster.sources)[0] ?? 'источник неизвестен';
  const sourceLine = `${source}${observedDate ? `, ${observedDate}` : ''}`;
  return (
    <span className="vacancies-screen-cell vacancies-screen-cell--salary" data-label="Деньги">
      <MoneyContent item={item} sourceLine={sourceLine} />
    </span>
  );
}
