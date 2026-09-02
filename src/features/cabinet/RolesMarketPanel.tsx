import { ArrowRight } from '@phosphor-icons/react';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { RoleMarketMap } from '../career-map/roleMarketMap';
import { pluralRu } from '../../../shared/pluralRu';
import type { PoolRoleHypothesis } from '../career-map/poolRoleHypotheses';
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
  marketRoles,
  poolComplete = true,
  poolTotal = 0,
  onNavigate,
}: {
  readonly journey?: CareerJourney;
  /**
   * Гипотезы, названные рынком: имя роли, её выборка и источники приходят из
   * пула вакансий, а не из строки резюме (B180, срез 1).
   */
  readonly marketRoles?: readonly PoolRoleHypothesis[];
  /** Пул читается страницами: выборка по половине пула — не выборка по пулу. */
  readonly poolComplete?: boolean;
  readonly poolTotal?: number;
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

      {marketRoles ? (
        <MarketRoleHypotheses roles={marketRoles} />
      ) : (
        <RoleHypotheses roles={roles} />
      )}

      <MarketSamples markets={markets} />

      {!poolComplete && observedCount(markets) > 0 ? (
        <p className="career-cabinet-tag">
          Пул ещё дочитывается: прочитано {observedCount(markets)} из {poolTotal} — числа
          вырастут.
        </p>
      ) : null}

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

/**
 * Роли, названные рынком. Каждая строка несёт своё число, окно наблюдения и
 * источники: роль без вакансий гипотезой не является.
 */
function MarketRoleHypotheses({ roles }: { readonly roles: readonly PoolRoleHypothesis[] }) {
  if (!roles.length) {
    return (
      <p className="career-home-empty">
        Роль ещё не названа рынком: в собранном пуле пока нет группы вакансий, по
        которой можно строить гипотезу.
      </p>
    );
  }
  return (
    <ol className="career-roles-list">
      {roles.map((role) => (
        <li key={role.id}>
          <strong>{role.title}</strong>
          <small>
            {pluralRu(role.sampleSize, ['вакансия', 'вакансии', 'вакансий'])} ·{' '}
            {observationWindow(role)} · {sourceSummary(role)}
          </small>
          {role.repeatedRequirements.length ? (
            <small>Повторяются: {role.repeatedRequirements.slice(0, 4).join(', ')}</small>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const SOURCE_NAMES: Record<string, string> = {
  hh: 'hh.ru',
  trudvsem: 'ТрудВсем',
  remotive: 'Remotive',
  telegram: 'Telegram-каналы',
};

function sourceSummary(role: PoolRoleHypothesis): string {
  return role.sources
    .slice(0, 3)
    .map((entry) => `${SOURCE_NAMES[entry.source] ?? entry.source} ${entry.count}`)
    .join(', ');
}

function observationWindow(role: PoolRoleHypothesis): string {
  const from = formatDay(role.observedFrom);
  const to = formatDay(role.observedTo);
  return from === to ? `наблюдение ${to}` : `наблюдение ${from} — ${to}`;
}

/** До трёх гипотез роли: название, на чём стоит и чего не хватает. */
function RoleHypotheses({ roles }: { readonly roles: RoleMarketMap['roles'] }) {
  if (!roles.length) {
    return (
      <p className="career-home-empty">
        Роль ещё не названа: гипотезы строятся из ваших фактов и вакансий пула.
      </p>
    );
  }
  return (
    <ol className="career-roles-list">
      {roles.map((role) => (
        <li key={role.id}>
          <strong>{role.title}</strong>
          <small>{role.basis}</small>
          {role.gaps.length ? <small className="is-gap">{role.gaps[0]}</small> : null}
        </li>
      ))}
    </ol>
  );
}

/** Сколько записей пула вообще попало хоть в одну выборку. */
function observedCount(markets: RoleMarketMap['markets']): number {
  return markets.reduce((sum, market) => sum + market.sampleSize, 0);
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
