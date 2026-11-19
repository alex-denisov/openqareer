import { calculateOfferCompensation } from '../../applications/offerCompensation';
import type { ApplicationOfferTerms } from '../../../../server/data/sqliteApplicationOfferRepository';
import { InfoTip } from '../kit';
import { formatFullMoney } from './model/offerModel';

function probationNote(terms: ApplicationOfferTerms, currency: string): string | null {
  const months = Math.min(Math.max(terms.probationPeriodMonths ?? 0, 0), 12);
  if (months === 0 || terms.probationSalary === undefined || terms.baseSalary === undefined)
    return null;
  return `${months} мес. по ${formatFullMoney(terms.probationSalary, currency)} и ${12 - months} мес. по ${formatFullMoney(terms.baseSalary, currency)}`;
}

/** «Доход за год по формуле» (O6a): пересчитывается, пока кандидат вносит числа. */
export function OfferCalc({ terms }: { readonly terms: ApplicationOfferTerms }) {
  const result = calculateOfferCompensation(terms);
  const note = result.hasProbationDiff ? probationNote(terms, result.currency) : null;
  return (
    <section className="mod of-calc" aria-labelledby="oc-t">
      <div className="eyebrow">
        Считаем по формуле
        <InfoTip
          label="Как посчитано"
          text="Год = оклад за год + бонус. Месяц = год ÷ 12. Если на испытательном другой оклад, он учтён за его месяцы. Пересчитывается, пока вы вносите числа."
        />
      </div>
      <h3 className="mod-title" id="oc-t">
        Доход за год по формуле
      </h3>
      <p className="of-total" aria-live="polite">
        <b className="num">{formatFullMoney(result.totalAnnualCompensation, result.currency)}</b>
        <span className="num">{`в среднем ${formatFullMoney(result.monthlyAverage, result.currency)} в месяц`}</span>
      </p>
      <dl className="of-sum">
        <div>
          <dt>Оклад за год</dt>
          <dd className="num">
            {formatFullMoney(result.annualBase, result.currency)}
            {note ? <small>{note}</small> : null}
          </dd>
        </div>
        <div>
          <dt>Бонус</dt>
          <dd className="num">{formatFullMoney(result.annualBonus, result.currency)}</dd>
        </div>
      </dl>
    </section>
  );
}
