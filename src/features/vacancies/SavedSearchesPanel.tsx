import { ArrowClockwise, Pause, Play, Plus, Trash } from '@phosphor-icons/react';
import type {
  VacancySourceId,
  VacancySourceRegistryEntry,
  VacancySubscription,
} from '../coach/coachApi';
import {
  SourceAttribution,
  cadenceLabel,
  fallbackSources,
  sourceFailureMessage,
  sourceHealthLabel,
} from '../cabinet/CareerIntelligencePanelParts';
import { useSavedSearches } from './useSavedSearches';

/**
 * «Регулярные выборки» — там же, где кандидат смотрит сами вакансии.
 *
 * Раньше выборки жили под кампанией в «Поиске», а пул — в «Вакансиях», и
 * кандидат заводил источник в одном разделе, а результат искал в другом
 * (решение владельца 2026-09-02, B181). Список найденного отсюда убран
 * намеренно: таблица пула стоит на том же экране справа, и дублировать её
 * четырьмя ссылками — значит показывать одни и те же вакансии дважды.
 */
// Один блок панели фильтров: шапка, переключатель и тело читаются вместе.
// eslint-disable-next-line max-lines-per-function
export function SavedSearchesPanel(props: {
  readonly subscriptions: readonly VacancySubscription[];
  readonly defaultQuery?: string;
  readonly onRefresh: () => Promise<void>;
  /** Форма новой выборки раскрыта «+» в панели фильтров (B234). */
  readonly createOpen?: boolean;
  /** Выборка заведена — панель фильтров закрывает форму. */
  readonly onCreated?: () => void;
}) {
  const state = useSavedSearches(props);
  const { active } = state;
  const showForm = props.createOpen || !active;

  return (
    <section className="career-saved-searches" aria-label="Сохранённые запросы">
      {active && !showForm ? (
        <header>
          <div>
            <h3 id="career-saved-searches-title">{active.analytics.sampleSize} найдено</h3>
          </div>
          <span className={`career-search-status is-${active.status}`}>
            {active.status === 'active' ? 'Собирается' : 'На паузе'}
          </span>
        </header>
      ) : null}

      {!showForm && props.subscriptions.length > 1 ? (
        <SavedSearchSwitcher
          subscriptions={props.subscriptions}
          activeId={state.activeId}
          sources={state.sources}
          onSelect={state.setActiveId}
        />
      ) : null}

      {active && !showForm ? (
        <SavedSearchDetails
          subscription={active}
          source={state.activeSource}
          busy={state.busy}
          onRefresh={() => void state.refresh(active.id)}
          onToggle={() => void state.toggle(active)}
          onRemove={() => void state.remove(active.id)}
        />
      ) : (
        <SavedSearchForm
          query={state.query}
          source={state.source}
          sources={state.sources}
          selectedSource={state.selectedSource}
          busy={state.busy}
          onQuery={state.setQuery}
          onSource={state.setSource}
          onSubmit={() =>
            void state.create().then((created) => {
              if (created) props.onCreated?.();
            })
          }
        />
      )}

      {state.error ? (
        <p className="career-expert-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

function SavedSearchSwitcher({
  subscriptions,
  activeId,
  sources,
  onSelect,
}: {
  readonly subscriptions: readonly VacancySubscription[];
  readonly activeId?: string;
  readonly sources: readonly VacancySourceRegistryEntry[];
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div className="career-search-switcher" aria-label="Поисковые направления">
      {subscriptions.map((subscription) => (
        <button
          type="button"
          key={subscription.id}
          className={subscription.id === activeId ? 'is-active' : ''}
          onClick={() => onSelect(subscription.id)}
        >
          {subscription.query} ·{' '}
          {sources.find((item) => item.id === subscription.source)?.name ?? subscription.source}
        </button>
      ))}
    </div>
  );
}

// Строка выборки и три её кнопки — одно управляющее целое.
// eslint-disable-next-line max-lines-per-function
function SavedSearchDetails({
  subscription,
  source,
  busy,
  onRefresh,
  onToggle,
  onRemove,
}: {
  readonly subscription: VacancySubscription;
  readonly source?: VacancySourceRegistryEntry;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
}) {
  const paused = subscription.status !== 'active';
  return (
    <>
      <div className="career-market-query-row">
        <div>
          <strong>{subscription.query}</strong>
          <small>
            {source?.name ?? subscription.source} · {sourceHealthLabel(source?.health.status)} ·
            обновляется каждые {cadenceLabel(subscription.cadenceMinutes)}
          </small>
        </div>
        <div>
          <button type="button" disabled={busy} onClick={onRefresh} aria-label="Собрать сейчас">
            <ArrowClockwise size={16} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            aria-label={paused ? 'Возобновить сбор' : 'Остановить сбор'}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button type="button" disabled={busy} onClick={onRemove} aria-label="Удалить запрос">
            <Trash size={16} />
          </button>
        </div>
      </div>

      {subscription.lastErrorCode ? (
        <p className="career-market-empty">
          {sourceFailureMessage(subscription.lastErrorCode, subscription.source)}
        </p>
      ) : null}
      {source ? <SourceAttribution source={source} /> : null}
    </>
  );
}

// Форма заведения выборки: источник, здоровье источника и запрос — один шаг.
// eslint-disable-next-line max-lines-per-function
function SavedSearchForm({
  query,
  source,
  sources,
  selectedSource,
  busy,
  onQuery,
  onSource,
  onSubmit,
}: {
  readonly query: string;
  readonly source: VacancySourceId;
  readonly sources: readonly VacancySourceRegistryEntry[];
  readonly selectedSource?: VacancySourceRegistryEntry;
  readonly busy: boolean;
  readonly onQuery: (value: string) => void;
  readonly onSource: (value: VacancySourceId) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <form
      className="career-market-create"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="career-saved-search-source">Источник вакансий</label>
      <select
        id="career-saved-search-source"
        data-testid="vacancy-source-select"
        value={source}
        onChange={(event) => onSource(event.target.value as VacancySourceId)}
        disabled={busy || sources.length === 0}
      >
        {(sources.length ? sources : fallbackSources).map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {item.market}
          </option>
        ))}
      </select>
      {selectedSource && selectedSource.health.status !== 'healthy' ? (
        <p className={`career-source-health is-${selectedSource.health.status}`}>
          {selectedSource.name}: {sourceHealthLabel(selectedSource.health.status)}
        </p>
      ) : null}
      <label htmlFor="career-saved-search-query">Роль или поисковый запрос</label>
      <div>
        <input
          id="career-saved-search-query"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Например, руководитель продукта"
          minLength={2}
          maxLength={200}
          required
        />
        <button
          type="submit"
          data-testid="vacancy-search-create"
          disabled={busy || query.trim().length < 2}
        >
          <Plus size={17} /> Создать
        </button>
      </div>
      {selectedSource ? <SourceAttribution source={selectedSource} /> : null}
    </form>
  );
}
