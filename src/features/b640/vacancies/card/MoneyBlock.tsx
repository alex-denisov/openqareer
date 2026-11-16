import { useId } from 'react';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { CampaignMetaView } from '../../../coach/matchedVacancyApi';
import { BarPart } from '../Bar';
import type { MoneyCurrency } from '../format';
import { moneyLines } from './moneyLines';
import { moneyScale } from './moneyScale';
import { SrcTip } from './SrcTip';

export interface MoneyBlockProps {
  readonly item: MatchedVacancyItem;
  readonly rates: CurrencyRates | undefined;
  readonly campaign: CampaignMetaView | undefined;
}

const CURRENCIES: readonly MoneyCurrency[] = ['RUB', 'USD', 'EUR', 'ORIG'];

function targetCurrency(campaign: CampaignMetaView | undefined): MoneyCurrency {
  const code = campaign?.salaryCurrency?.toUpperCase();
  return CURRENCIES.find((value) => value === code) ?? 'RUB';
}

/** «Деньги»: сумма, при пересчёте — исходная и курс; шкала рынка и вилки, если есть оценка рынка. */
export function MoneyBlock({ item, rates, campaign }: MoneyBlockProps) {
  const titleId = useId();
  const lines = moneyLines(item, rates, targetCurrency(campaign));
  if (!lines) return null;
  const market = item.explanation.marketSalary;
  const scale = market ? moneyScale(market, item.cluster.salary, rates) : null;
  return (
    <section className="mod v4-money" aria-labelledby={titleId}>
      <h3 className="mod-title" id={titleId}>
        Деньги
        <SrcTip label="Откуда это число" text={lines.tip} />
      </h3>
      <div className="vg-b vg-money">
        <p className="vg-big num">
          {lines.big}
          <small>{lines.small}</small>
        </p>
        {lines.converted ? <p className="vg-sub num">{lines.converted}</p> : null}
        {scale ? (
          <>
            <div className="vg-scale" role="img" aria-label="Шкала: рынок и вилка вакансии">
              <BarPart className="vg-mk" start={scale.market.start} size={scale.market.size} />
              {scale.fork ? (
                <BarPart className="vg-fork" start={scale.fork.start} size={scale.fork.size} />
              ) : null}
            </div>
            {scale.fork ? (
              <p className="vg-sub vg-leg">
                <span className="vg-kw">
                  <span className="vg-k is-fork" />
                  вилка
                </span>
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
