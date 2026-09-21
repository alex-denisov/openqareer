import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { VacancySubscription } from '../coach/coachApi';
import { SavedSearchesPanel } from './SavedSearchesPanel';
import type { VacancyFacetCounts } from './vacancyFacets';
import type { VacancyFilters } from './vacancyFilters';

/**
 * Панель фильтров «Вакансий» по макету «Пульт» (B234).
 *
 * Порядок — как в макете: заголовок «Фильтры · сброс», поиск, сохранённые
 * выборки пилюлями, роль, страна, релокация, формат, свежесть, источник.
 * Заведение регулярной выборки (источник + запрос + «Создать») спрятано за
 * «+»: владелец (2026-09-20) не понял, зачем «создавать» и «указывать
 * источник», когда ему нужен фильтр. Поле «роль» — фильтр по названию
 * вакансии в пуле, роль кампании стоит подсказкой.
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
  sources,
  countries,
  onChange,
  onReset,
  subscriptions,
  defaultQuery,
  onRefresh,
}: {
  readonly filters: VacancyFilters;
  readonly facets: VacancyFacetCounts;
  readonly sources: ReadonlyArray<{ source: string; count: number }>;
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
          сброс
        </button>
      </header>

      <label className="career-vacancy-search">
        <input
          aria-label="Название или работодатель"
          type="search"
          value={filters.query ?? ''}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Название, компания…"
        />
      </label>

      <SavedSearchesFold
        subscriptions={subscriptions}
        defaultQuery={defaultQuery}
        onRefresh={onRefresh ?? (async () => undefined)}
      />

      <fieldset>
        <legend>Роль</legend>
        <input
          className="career-vacancy-role"
          name="vacancy-role-filter"
          type="search"
          value={filters.role ?? ''}
          onChange={(event) => onChange({ ...filters, role: event.target.value })}
          placeholder={defaultQuery ?? 'Название роли'}
          aria-label="Роль: подстрока названия вакансии"
        />
      </fieldset>

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

      <SourceFilter filters={filters} sources={sources} onChange={onChange} />
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
      <legend>Сохранённые</legend>
      <div className="career-vacancy-chips">
        {subscriptions.map((subscription) => (
          <span key={subscription.id} className="career-vacancy-saved-pill">
            {subscription.query}
          </span>
        ))}
        <button
          type="button"
          className={open ? 'is-active' : ''}
          aria-pressed={open}
          aria-label="Новая регулярная выборка"
          title="Новая регулярная выборка: площадка сама присылает вакансии по запросу"
          onClick={() => setOpen((value) => !value)}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </div>
      {subscriptions.length === 0 && !open ? (
        <p className="career-cabinet-tag">
          Регулярная выборка — запрос к площадке, который повторяется сам и пополняет пул.
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
          <button
            key={country}
            type="button"
            className={filters.country === country ? 'is-active' : ''}
            aria-pressed={filters.country === country}
            title={`${count} в пуле`}
            onClick={() =>
              onChange({
                ...filters,
                country: filters.country === country ? undefined : country,
              })
            }
          >
            {country}
          </button>
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
  const rows: ReadonlyArray<{
    key: 'relocationOnly' | 'currencyRemoteOnly' | 'russianAbroadOnly';
    label: string;
    count: number;
  }> = [
    { key: 'relocationOnly', label: 'Помощь с переездом', count: facets.relocation.count },
    { key: 'currencyRemoteOnly', label: 'Валютная удалёнка', count: facets.currencyRemote.count },
    {
      key: 'russianAbroadOnly',
      label: 'Российские компании за рубежом',
      count: facets.russianAbroad.count,
    },
  ];
  return (
    <fieldset>
      <legend>Релокация</legend>
      <ul className="career-vacancy-sources">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              className={filters[row.key] ? 'is-active' : ''}
              aria-pressed={Boolean(filters[row.key])}
              onClick={() => onChange({ ...filters, [row.key]: !filters[row.key] })}
            >
              <span>{row.label}</span>
              <strong>{row.count}</strong>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * Свежесть — узел 15 пути пилота. Подпись обязана называть, от чего считается
 * возраст: даты публикации источники отдают не всегда, поэтому счёт идёт от
 * первого сбора записи, и выдавать одно за другое нельзя.
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
      <legend>Свежесть</legend>
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
      <p className="career-cabinet-tag">
        От первого попадания в базу: дату публикации площадки отдают не всегда.
      </p>
    </fieldset>
  );
}

/** Источники со счётчиками: фильтр обязан говорить, сколько за ним записей. */
function SourceFilter({
  filters,
  sources,
  onChange,
}: {
  readonly filters: VacancyFilters;
  readonly sources: ReadonlyArray<{ source: string; count: number }>;
  readonly onChange: (filters: VacancyFilters) => void;
}) {
  return (
    <fieldset>
      <legend>Источник</legend>
      <ul className="career-vacancy-sources">
        {sources.map(({ source, count }) => (
          <li key={source}>
            <button
              type="button"
              className={filters.source === source ? 'is-active' : ''}
              aria-pressed={filters.source === source}
              onClick={() =>
                onChange({
                  ...filters,
                  source: filters.source === source ? undefined : source,
                })
              }
            >
              <span>{source}</span>
              <strong>{count}</strong>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
