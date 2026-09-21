import { useState } from 'react';
import { Info, Plus } from '@phosphor-icons/react';
import type { VacancySubscription } from '../coach/coachApi';
import { SavedSearchesPanel } from './SavedSearchesPanel';
import type { VacancyFacetCounts } from './vacancyFacets';
import { IN_BASE_HINT, type VacancyFilters } from './vacancyFilters';
import { VACANCY_CONDITIONS } from './vacancyConditions';
import { CareerTooltip } from '../shell/CareerTooltip';

/**
 * Панель фильтров «Вакансий» по макету «Пульт» (B234).
 *
 * Порядок — как в макете: заголовок «Фильтры · сброс», поиск, сохранённые
 * выборки пилюлями, страна, релокация, формат и свежесть. Источник не является
 * пользовательским фильтром: общий пул должен отбираться по критериям вакансии
 * и роли, а не по площадке.
 */
const VISIBLE_COUNTRIES = 3;

const FRESHNESS_CHOICES: ReadonlyArray<{ label: string; days?: number }> = [
  { label: 'до 7 дней', days: 7 },
  { label: 'до 30 дней', days: 30 },
  { label: 'любая', days: undefined },
];

// Панель — один список блоков в порядке макета; разнести по файлам значило бы
// спрятать порядок, который и есть предмет B234.
// eslint-disable-next-line max-lines-per-function
export function VacancyFilterPanel({
  filters,
  facets,
  countries,
  onChange,
  onReset,
  subscriptions,
  defaultQuery,
  onRefresh,
}: {
  readonly filters: VacancyFilters;
  readonly facets: VacancyFacetCounts;
  readonly countries: ReadonlyArray<{ country: string; count: number }>;
  readonly onChange: (filters: VacancyFilters) => void;
  readonly onReset: () => void;
  readonly subscriptions: readonly VacancySubscription[];
  readonly defaultQuery?: string;
  readonly onRefresh?: () => Promise<void>;
}) {
  return (
    <aside className="career-vacancy-filters" aria-label="Фильтры вакансий">
      <header>
        <h3>Фильтры</h3>
        <button className="career-inline-link" type="button" onClick={onReset}>
          Сбросить
        </button>
      </header>

      <label className="career-vacancy-search">
        <input
          aria-label="Роль, название вакансии или работодатель"
          type="search"
          value={filters.query ?? ''}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Роль, вакансия или компания…"
        />
      </label>

      <SavedSearchesFold
        subscriptions={subscriptions}
        defaultQuery={defaultQuery}
        onRefresh={onRefresh ?? (async () => undefined)}
      />

      <CountryFilter filters={filters} countries={countries} onChange={onChange} />

      <RelocationFilter filters={filters} facets={facets} onChange={onChange} />

      <fieldset>
        <legend>Формат</legend>
        <div className="career-vacancy-chips">
          <button
            type="button"
            className={filters.remoteOnly ? 'is-active' : ''}
            aria-pressed={Boolean(filters.remoteOnly)}
            onClick={() => onChange({ ...filters, remoteOnly: !filters.remoteOnly })}
          >
            Удалённо
          </button>
        </div>
      </fieldset>

      <FreshnessFilter filters={filters} onChange={onChange} />

    </aside>
  );
}

/** «Сохранённые»: выборки пилюлями, «+» раскрывает форму новой выборки. */
function SavedSearchesFold({
  subscriptions,
  defaultQuery,
  onRefresh,
}: {
  readonly subscriptions: readonly VacancySubscription[];
  readonly defaultQuery?: string;
  readonly onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <fieldset className="career-vacancy-saved">
      <legend>Сохранённые запросы</legend>
      <div className="career-vacancy-chips">
        {subscriptions.map((subscription) => (
          <span key={subscription.id} className="career-vacancy-saved-pill">
            {subscription.query}
          </span>
        ))}
        <CareerTooltip content="Новый запрос к площадке. Он повторяется сам и пополняет подбор.">
          <button
            type="button"
            className={open ? 'is-active' : ''}
            aria-pressed={open}
            aria-label="Новый запрос к площадке"
            onClick={() => setOpen((value) => !value)}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
        </CareerTooltip>
      </div>
      {subscriptions.length === 0 && !open ? (
        <p className="career-cabinet-tag">
          Сохранённый запрос повторяется по расписанию и пополняет подбор.
        </p>
      ) : null}
      {open || subscriptions.length > 0 ? (
        <SavedSearchesPanel
          subscriptions={subscriptions}
          defaultQuery={defaultQuery}
          onRefresh={onRefresh}
          createOpen={open}
          onCreated={() => setOpen(false)}
        />
      ) : null}
    </fieldset>
  );
}

function CountryFilter({
  filters,
  countries,
  onChange,
}: {
  readonly filters: VacancyFilters;
  readonly countries: ReadonlyArray<{ country: string; count: number }>;
  readonly onChange: (filters: VacancyFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (countries.length === 0) return null;
  const visible = expanded ? countries : countries.slice(0, VISIBLE_COUNTRIES);
  const hidden = countries.length - visible.length;
  return (
    <fieldset>
      <legend>Страна</legend>
      <div className="career-vacancy-chips">
        {visible.map(({ country, count }) => (
          <CareerTooltip key={country} content={`${count} вакансий в подборе`}>
            <button
              type="button"
              className={filters.country === country ? 'is-active' : ''}
              aria-pressed={filters.country === country}
              onClick={() =>
                onChange({
                  ...filters,
                  country: filters.country === country ? undefined : country,
                })
              }
            >
              {country}
            </button>
          </CareerTooltip>
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={`Ещё ${hidden} стран`}
          >
            +{hidden}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}

/** Три среза работодателей — строками «подпись · счёт из пула», как в макете. */
function RelocationFilter({
  filters,
  facets,
  onChange,
}: {
  readonly filters: VacancyFilters;
  readonly facets: VacancyFacetCounts;
  readonly onChange: (filters: VacancyFilters) => void;
}) {
  // Те же имена и иконки, что на бейджах строки: чип и бейдж зовутся одинаково (B236 §4.5).
  const rows = VACANCY_CONDITIONS.map((condition) => ({
    ...condition,
    count: facets[condition.feature].count,
  }));
  return (
    <fieldset>
      <legend>Условия</legend>
      <ul className="career-vacancy-sources">
        {rows.map((row) => (
          <li key={row.filter}>
            <button
              type="button"
              className={filters[row.filter] ? 'is-active' : ''}
              aria-pressed={Boolean(filters[row.filter])}
              onClick={() => onChange({ ...filters, [row.filter]: !filters[row.filter] })}
            >
              <span>
                <row.Icon size={12} aria-hidden="true" /> {row.label}
              </span>
              <strong>{row.count}</strong>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * «В базе» — узел 15 пути пилота. От чего считается число, сказано один раз
 * в подсказке легенды (`IN_BASE_HINT`): даты публикации источники отдают не
 * всегда, поэтому счёт идёт от первого сбора записи, и выдавать одно за
 * другое нельзя.
 */
function FreshnessFilter({
  filters,
  onChange,
}: {
  readonly filters: VacancyFilters;
  readonly onChange: (filters: VacancyFilters) => void;
}) {
  return (
    <fieldset>
      <legend>
        <CareerTooltip content={IN_BASE_HINT}>
          <span className="career-vacancy-column-hint">
            В базе <Info size={12} aria-hidden="true" />
          </span>
        </CareerTooltip>
      </legend>
      <div className="career-vacancy-chips">
        {FRESHNESS_CHOICES.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className={filters.freshness === choice.days ? 'is-active' : ''}
            aria-pressed={filters.freshness === choice.days}
            onClick={() => onChange({ ...filters, freshness: choice.days })}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
