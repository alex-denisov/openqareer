import { useId } from 'react';
import { formatQuotaNumber, type TariffQuotaSummary } from './tariffQuotaApi';
import { useTariffQuotas } from './useTariffQuotas';

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** B579: остаток квот тарифа на экране «Тарифы». */
export function TariffQuotaPanel() {
  const summary = useTariffQuotas();
  if (!summary || summary.unlimited || !summary.period) return null;
  return <TariffQuotaList summary={summary} />;
}

export function TariffQuotaList({ summary }: { readonly summary: TariffQuotaSummary }) {
  const available = summary.quotas.filter((quota) => quota.limit > 0);
  const resetsOn = summary.period ? DATE_FORMAT.format(new Date(summary.period.endsAt)) : null;
  const titleId = useId();
  return (
    <section className="career-quota-panel" aria-labelledby={titleId}>
      <div className="career-quota-head">
        <h3 className="career-quota-title" id={titleId}>
          Остаток в этом месяце
        </h3>
        {resetsOn ? <span className="career-quota-reset">обновится {resetsOn}</span> : null}
      </div>
      <ul className="career-quota-list">
        {available.map((quota) => (
          <li
            key={quota.key}
            className={`career-quota-row${quota.remaining === 0 ? ' is-exhausted' : ''}`}
          >
            <span className="career-quota-label">{quota.label}</span>
            <span className="career-quota-value">
              {formatQuotaNumber(quota.remaining)} из {formatQuotaNumber(quota.limit)}
            </span>
          </li>
        ))}
        {summary.fitPercentLimit ? (
          <li className="career-quota-row">
            <span className="career-quota-label">Процент совпадения</span>
            <span className="career-quota-value">
              первые {formatQuotaNumber(summary.fitPercentLimit)} вакансий
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
