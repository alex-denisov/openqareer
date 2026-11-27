import { ChartBar } from '@phosphor-icons/react';

import { formatMarketSalaryRange, marketSalaryLabel } from '../../../shared/marketSalaryEstimate';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { formatStatedCompensation } from './vacancyCompensation';

type MarketSalary = NonNullable<MatchedVacancyItem['explanation']['marketSalary']>;

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
        {formatStatedCompensation(item.cluster.salary)}
      </span>
      <span className="vacancy-screen-money-source">указана в вакансии · {sourceLine}</span>
    </>
  );
}

function MarketEstimate({ estimate }: { readonly estimate: MarketSalary }) {
  return (
    <>
      <span className="career-numeric vacancy-screen-money-value">
        {formatMarketSalaryRange(estimate)}
        <span className="vacancy-screen-money-narrow vacancy-screen-money-short">оценка</span>
      </span>
      <span className="vacancy-screen-money-source is-estimate">
        <span className="vacancy-screen-money-tag">
          <ChartBar aria-hidden="true" />
          {marketSalaryLabel(estimate.computedAt)}
        </span>
      </span>
    </>
  );
}

/** «Деньги» (B546, B803): the stated salary or the openqareer estimate with its date. */
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
  return <MarketEstimate estimate={estimate} />;
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
          value: formatStatedCompensation(item.cluster.salary),
          note: 'Зарплата указана в вакансии',
          fromSource: true,
        }
      : { value: 'не указана', note: 'Зарплата в вакансии не указана', fromSource: true };
  }
  return {
    value: `${formatMarketSalaryRange(estimate)} оценка`,
    note: marketSalaryLabel(estimate.computedAt),
    fromSource: false,
  };
}
