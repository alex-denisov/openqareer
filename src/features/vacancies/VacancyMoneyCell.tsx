import { ChartBar } from '@phosphor-icons/react';

import { formatMarketSalaryRange, marketSalaryBasis } from '../../../shared/marketSalaryEstimate';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { formatCompensationCompact } from './vacancyCompensation';

type MarketSalary = NonNullable<MatchedVacancyItem['explanation']['marketSalary']>;

/** 390 says «без зарплаты» in place of the wide value (mockup 390 list). */
function NarrowMissing() {
  return <span className="vacancy-screen-money-narrow vacancy-screen-money-alt">без зарплаты</span>;
}

function StatedOrMissing({
  item,
  sourceLine,
}: {
  readonly item: MatchedVacancyItem;
  readonly sourceLine: string;
}) {
  if (!item.cluster.salary) {
    return (
      <>
        <span className="career-numeric vacancy-screen-money-value vacancy-screen-money-alt">
          без зарплаты
        </span>
        <span className="vacancy-screen-money-source">{sourceLine}</span>
      </>
    );
  }
  return (
    <>
      <span className="career-numeric vacancy-screen-money-value">
        {formatCompensationCompact(item.cluster.salary)}
      </span>
      <span className="vacancy-screen-money-source">указана в вакансии · {sourceLine}</span>
    </>
  );
}

function ThinSample({ estimate }: { readonly estimate: MarketSalary }) {
  return (
    <>
      <span className="career-numeric vacancy-screen-money-value vacancy-screen-money-wide">
        мало данных
      </span>
      <NarrowMissing />
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

/** The same «Деньги» answer as one value and one note, for the 390 push (G5, item 8). */
export function vacancyMoneySummary(item: MatchedVacancyItem): {
  readonly value: string;
  readonly note: string;
  readonly fromSource: boolean;
} {
  const estimate = item.explanation.marketSalary;
  if (item.cluster.salary || !estimate) {
    return item.cluster.salary
      ? {
          value: formatCompensationCompact(item.cluster.salary),
          note: 'Зарплата указана в вакансии',
          fromSource: true,
        }
      : { value: 'не указана', note: 'Зарплата в вакансии не указана', fromSource: true };
  }
  const basis = marketSalaryBasis(estimate.sampleSize, estimate.computedAt);
  if (estimate.low === undefined || estimate.high === undefined) {
    return { value: 'мало данных', note: `Нет зарплаты, оценка ${basis}`, fromSource: false };
  }
  const range = formatMarketSalaryRange({
    low: estimate.low,
    high: estimate.high,
    currency: estimate.currency,
  });
  return { value: `${range} оценка`, note: `Оценка рынка ${basis}`, fromSource: false };
}
