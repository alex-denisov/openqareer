import { useId } from 'react';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { CampaignMetaView } from '../../../coach/matchedVacancyApi';
import { BarPart } from '../Bar';
import { usePreferredMoneyCurrency } from '../../account/usePreferredMoneyCurrency';
import { moneyLines, targetMoneyCurrency } from './moneyLines';
import { moneyScale, type Expectation, type MoneyScale } from './moneyScale';
import { SrcTip } from './SrcTip';

export interface MoneyBlockProps {
  readonly item: MatchedVacancyItem;
  readonly rates: CurrencyRates | undefined;
  readonly campaign: CampaignMetaView | undefined;
  /** Ожидания кандидата из профиля («Зарплата от»). */
  readonly expectation?: Expectation | undefined;
}

const VERDICTS = {
  below: 'ниже',
  inside: 'внутри',
  above: 'выше',
} as const;

function verdictText(scale: MoneyScale): string {
  const against = scale.verdictAgainst === 'fork' ? 'вилки' : 'оценки рынка';
  return `Ваши ожидания ${VERDICTS[scale.verdict ?? 'inside']} ${against}`;
}

function Scale({ scale }: { readonly scale: MoneyScale }) {
  return (
    <>
      <div
        className="vg-scale"
        role="img"
        aria-label="Шкала: рынок, вилка вакансии и ваши ожидания"
      >
        {scale.market ? (
          <BarPart className="vg-mk" start={scale.market.start} size={scale.market.size} />
        ) : null}
        {scale.fork ? (
          <BarPart className="vg-fork" start={scale.fork.start} size={scale.fork.size} />
        ) : null}
        {scale.me !== undefined ? <BarPart className="vg-me" start={scale.me} /> : null}
      </div>
      <p className="vg-sub vg-leg">
        {scale.fork ? (
          <span className="vg-kw">
            <span className="vg-k is-fork" />
            вилка
          </span>
        ) : null}
        {scale.market && !scale.fork ? (
          <span className="vg-kw">
            <span className="vg-k is-mk" />
            рынок
          </span>
        ) : null}
        {scale.me !== undefined ? (
          <span className="vg-kw">
            <span className="vg-k is-me" />
            ваши ожидания
          </span>
        ) : null}
      </p>
    </>
  );
}

/** «Деньги»: сумма, при пересчёте — исходная и курс; шкала рынка и вилки, если есть оценка рынка. */
export function MoneyBlock({ item, rates, campaign, expectation }: MoneyBlockProps) {
  const titleId = useId();
  const preferred = usePreferredMoneyCurrency();
  const lines = moneyLines(item, rates, targetMoneyCurrency(preferred, campaign?.salaryCurrency));
  if (!lines) return null;
  const market = item.explanation.marketSalary;
  const scale = moneyScale(market, item.cluster.salary, rates, expectation);
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
        {scale?.verdict ? (
          <p className="vg-sub num">
            <b>{verdictText(scale)}</b>
          </p>
        ) : null}
        {scale ? <Scale scale={scale} /> : null}
      </div>
    </section>
  );
}
