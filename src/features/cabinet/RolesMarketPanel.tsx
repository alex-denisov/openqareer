import { ArrowRight } from '@phosphor-icons/react';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { RoleMarketMap } from '../career-map/roleMarketMap';
import { pluralRu } from '../../../shared/pluralRu';
import type { CareerCabinetView } from './cabinetViews';

/**
 * «Роли и рынок» — карта ролей и выборка вакансий за ней (B104, B118).
 *
 * Движок карты был написан и покрыт тестами, но в «Пульт» не попал, а рынку он
 * отдавал пустые наблюдения — поэтому вошедший кандидат не видел ни одной
 * гипотезы роли. Теперь наблюдения берутся из собранного пула, и каждое число
 * на экране называет свою выборку, дату наблюдения и источник.
 *
 * Маленькая выборка — это отказ, а не маленькое число: одна компания со своим
 * шаблоном требований переворачивает картину, и показывать её как рынок
 * нечестно.
 */
export function RolesMarketPanel({
  journey,
  onNavigate,
}: {
  readonly journey?: CareerJourney;
  readonly onNavigate: (view: CareerCabinetView) => void;
}) {
  const map = journey?.roleMarketMap;
  if (!map) return null;
  const roles = map.roles.slice(0, 3);
  const markets = map.markets;

  return (
    <section className="career-home-panel career-roles-market" aria-labelledby="career-roles-title">
      <header>
        <h3 id="career-roles-title">Роли и рынок</h3>
        <span className="career-cabinet-tag">по вашему пулу</span>
      </header>

      {roles.length ? (
        <ol className="career-roles-list">
          {roles.map((role) => (
            <li key={role.id}>
              <strong>{role.title}</strong>
              <small>{role.basis}</small>
              {role.gaps.length ? <small className="is-gap">{role.gaps[0]}</small> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="career-home-empty">
          Роль ещё не названа: гипотезы строятся из ваших фактов и вакансий пула.
        </p>
      )}

      <MarketSamples markets={markets} />

      <button
        type="button"
        className="career-quiet-button"
        onClick={() => onNavigate('opportunities')}
      >
        Открыть вакансии за этими числами <ArrowRight size={15} />
      </button>
    </section>
  );
}

/** Выборка рынка: число, дата наблюдения и повторяющиеся требования. */
function MarketSamples({ markets }: { readonly markets: RoleMarketMap['markets'] }) {
  return (
    <ul className="career-market-list">
      {markets.map((market) => (
        <li key={market.id}>
          <span>{market.label}</span>
          {market.certainty === 'fact' && market.lastObservedAt ? (
            <span className="career-market-sample">
              <strong>
                {pluralRu(market.sampleSize, ['вакансия', 'вакансии', 'вакансий'])}
              </strong>{' '}
              · наблюдение{' '}
              {formatDay(market.lastObservedAt)}
            </span>
          ) : (
            <span className="career-market-sample is-unknown">
              Выборки не хватает{market.sampleSize > 0 ? `: собрано ${market.sampleSize}` : ''}
            </span>
          )}
          {market.certainty === 'fact' && market.repeatedRequirements.length ? (
            <small>Повторяются: {market.repeatedRequirements.slice(0, 5).join(', ')}</small>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(value),
  );
}
