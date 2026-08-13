import { useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  Briefcase,
  CheckCircle,
  Pause,
  Play,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  CoachApiError,
  createVacancySubscription,
  deleteVacancySubscription,
  getVacancySubscription,
  getVacancySources,
  refreshVacancySubscription,
  updateVacancySubscription,
  type CandidateSnapshot,
  type VacancySubscription,
  type VacancySubscriptionView,
  type VacancySourceId,
  type VacancySourceRegistryEntry,
} from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';

interface CareerIntelligencePanelProps {
  snapshot?: CandidateSnapshot;
  journey?: CareerJourney;
  defaultQuery?: string;
  loading: boolean;
  expanded?: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (view: 'profile' | 'career' | 'opportunities') => void;
}

// The market panel keeps its state transitions beside the conditional UI they govern.
// eslint-disable-next-line max-lines-per-function
export function CareerIntelligencePanel({
  snapshot,
  journey,
  defaultQuery,
  loading,
  expanded = false,
  onRefresh,
  onNavigate,
}: CareerIntelligencePanelProps) {
  const subscriptions = useMemo(
    () => snapshot?.vacancySubscriptions ?? [],
    [snapshot?.vacancySubscriptions],
  );
  const [activeId, setActiveId] = useState<string>();
  const [view, setView] = useState<VacancySubscriptionView>();
  const [query, setQuery] = useState(defaultQuery ?? '');
  const [source, setSource] = useState<VacancySourceId>('hh');
  const [sources, setSources] = useState<VacancySourceRegistryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!query && defaultQuery) setQuery(defaultQuery);
  }, [defaultQuery, query]);

  useEffect(() => {
    let active = true;
    void getVacancySources()
      .then((result) => {
        if (active) setSources(result);
      })
      .catch((reason) => {
        if (active) setError(intelligenceError(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextId =
      activeId && subscriptions.some((item) => item.id === activeId)
        ? activeId
        : subscriptions[0]?.id;
    if (!nextId) {
      if (!activeId) setView(undefined);
      return;
    }
    if (nextId !== activeId) setActiveId(nextId);
    let active = true;
    void getVacancySubscription(nextId)
      .then((result) => {
        if (active) setView(result);
      })
      .catch((reason) => {
        if (active) setError(intelligenceError(reason));
      });
    return () => {
      active = false;
    };
  }, [activeId, subscriptions]);

  async function createSearch(event: React.FormEvent) {
    event.preventDefault();
    const clean = query.trim();
    if (clean.length < 2) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await createVacancySubscription({
        source,
        query: clean,
        cadenceMinutes: 360,
      });
      setActiveId(created.subscription.id);
      setView(created);
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSearch(subscriptionId: string) {
    setBusy(true);
    setError(undefined);
    try {
      const refreshed = await refreshVacancySubscription(subscriptionId);
      setView(refreshed);
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSearch(subscription: VacancySubscription) {
    setBusy(true);
    setError(undefined);
    try {
      await updateVacancySubscription(
        subscription.id,
        subscription.status === 'active' ? 'paused' : 'active',
      );
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function removeSearch(subscriptionId: string) {
    setBusy(true);
    setError(undefined);
    try {
      await deleteVacancySubscription(subscriptionId);
      setActiveId(undefined);
      setView(undefined);
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  const activeSubscription =
    view?.subscription ?? subscriptions.find((item) => item.id === activeId);
  const activeView =
    view?.subscription.id === activeSubscription?.id ? view : undefined;
  const activeSource = sources.find((item) => item.id === activeSubscription?.source);
  const selectedSource = sources.find((item) => item.id === source);

  return (
    <aside
      className={`career-intelligence-panel ${expanded ? 'is-expanded' : ''}`}
      aria-labelledby="career-intelligence-title"
    >
      <header className="career-cabinet-panel-heading">
        <div>
          <span className="career-cabinet-kicker">Аналитика</span>
          <h2 id="career-intelligence-title">Рынок и следующие шаги</h2>
        </div>
      </header>

      <AtsReadability journey={journey} onOpenProfile={() => onNavigate('profile')} />

      <section className="career-market-watch" aria-labelledby="career-market-watch-title">
        <header>
          <div>
            <span>Регулярный поиск</span>
            <h3 id="career-market-watch-title">
              {activeSubscription
                ? `${activeSubscription.analytics.sampleSize} вакансий в выборке`
                : 'Настройте направление'}
            </h3>
          </div>
          {activeSubscription ? (
            <span className={`career-search-status is-${activeSubscription.status}`}>
              {activeSubscription.status === 'active' ? 'Активен' : 'На паузе'}
            </span>
          ) : null}
        </header>

        {subscriptions.length > 1 ? (
          <div className="career-search-switcher" aria-label="Поисковые направления">
            {subscriptions.map((subscription) => (
              <button
                type="button"
                key={subscription.id}
                className={subscription.id === activeId ? 'is-active' : ''}
                onClick={() => setActiveId(subscription.id)}
              >
                {subscription.query} ·{' '}
                {sources.find((item) => item.id === subscription.source)?.name ??
                  subscription.source}
              </button>
            ))}
          </div>
        ) : null}

        {activeSubscription ? (
          <>
            <div className="career-market-query-row">
              <div>
                <strong>{activeSubscription.query}</strong>
                <small>
                  {activeSource?.name ?? activeSubscription.source} ·{' '}
                  {sourceHealthLabel(activeSource?.health.status)} · каждые{' '}
                  {cadenceLabel(activeSubscription.cadenceMinutes)}
                </small>
              </div>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshSearch(activeSubscription.id)}
                  aria-label="Обновить выборку"
                >
                  <ArrowClockwise size={16} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleSearch(activeSubscription)}
                  aria-label={
                    activeSubscription.status === 'active'
                      ? 'Поставить поиск на паузу'
                      : 'Возобновить поиск'
                  }
                >
                  {activeSubscription.status === 'active' ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeSearch(activeSubscription.id)}
                  aria-label="Удалить поисковое направление"
                >
                  <Trash size={16} />
                </button>
              </div>
            </div>

            <MarketAnalytics subscription={activeSubscription} />

            {activeView?.vacancies.length ? (
              <div className="career-cabinet-vacancies">
                {activeView.vacancies.slice(0, expanded ? 12 : 4).map((vacancy) => (
                  <a key={vacancy.id} href={vacancy.sourceUrl} target="_blank" rel="noreferrer">
                    <Briefcase size={16} />
                    <span>
                      <strong>{vacancy.title}</strong>
                      <small>
                        {vacancy.company} · {vacancy.location}
                      </small>
                    </span>
                    <ArrowRight size={15} />
                  </a>
                ))}
              </div>
            ) : (
              <p className="career-market-empty">
                {activeSubscription.lastErrorCode
                  ? sourceFailureMessage(activeSubscription.lastErrorCode)
                  : activeView
                    ? 'В последней выборке совпадений нет.'
                    : 'Обновляем выборку…'}
              </p>
            )}
            {activeSource ? <SourceAttribution source={activeSource} /> : null}
            {activeView?.vacancies.length && !expanded ? (
              <button
                className="career-inline-link"
                type="button"
                onClick={() => onNavigate('opportunities')}
              >
                Открыть всю выборку <ArrowRight size={15} />
              </button>
            ) : null}
          </>
        ) : (
          <form className="career-market-create" onSubmit={createSearch}>
            <label htmlFor="career-market-source">Источник вакансий</label>
            <select
              id="career-market-source"
              data-testid="vacancy-source-select"
              value={source}
              onChange={(event) => setSource(event.target.value as VacancySourceId)}
              disabled={busy || sources.length === 0}
            >
              {(sources.length ? sources : fallbackSources).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.market}
                </option>
              ))}
            </select>
            {selectedSource ? (
              <p className={`career-source-health is-${selectedSource.health.status}`}>
                {sourceHealthLabel(selectedSource.health.status)} ·{' '}
                {selectedSource.searchCoverage}
              </p>
            ) : null}
            <label htmlFor="career-market-query">Роль или поисковый запрос</label>
            <div>
              <input
                id="career-market-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
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
            <small>После создания первая выборка запускается сразу, затем — каждые 6 часов.</small>
            {selectedSource ? <SourceAttribution source={selectedSource} /> : null}
          </form>
        )}
      </section>

      <NextAction journey={journey} onNavigate={onNavigate} />

      {loading && !snapshot ? <p className="career-cabinet-loading">Обновляем рынок…</p> : null}
      {error ? (
        <p className="career-expert-error" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

const fallbackSources = [
  { id: 'hh', name: 'hh.ru', market: 'Россия и СНГ' },
  { id: 'remotive', name: 'Remotive', market: 'Международный remote' },
] as const;

function SourceAttribution({ source }: { source: VacancySourceRegistryEntry }) {
  return (
    <a
      className="career-source-attribution"
      href={source.attributionUrl}
      target="_blank"
      rel="noreferrer"
    >
      Источник: {source.name}
    </a>
  );
}

function sourceHealthLabel(status?: VacancySourceRegistryEntry['health']['status']) {
  return {
    healthy: 'источник доступен',
    degraded: 'временные ошибки',
    unavailable: 'временно недоступен',
    official_access_required: 'нужен официальный доступ',
    not_checked: 'ещё не проверен',
  }[status ?? 'not_checked'];
}

function sourceFailureMessage(errorCode: string) {
  if (errorCode === 'source_replaced_review_required') {
    return 'Источник заменён на Remotive после production-сбоя. Проверьте направление и возобновите его вручную.';
  }
  if (errorCode === 'official_access_required') {
    return 'Нужен официальный доступ к API. Поиск сохранён, но данные не отмечены свежими.';
  }
  if (errorCode === 'source_rate_limited') {
    return 'Источник ограничил частоту запросов. Поиск сохранён и повторится после Retry-After.';
  }
  return 'Источник сейчас недоступен. Поиск сохранён и повторится по расписанию.';
}

function AtsReadability({
  journey,
  onOpenProfile,
}: {
  journey?: CareerJourney;
  onOpenProfile: () => void;
}) {
  const findings = (journey?.diagnostic.findings ?? []).filter((finding) =>
    ['readability', 'ats', 'evidence', 'freshness'].includes(finding.dimension),
  );
  const known = findings.filter((finding) => finding.certainty === 'fact').length;
  return (
    <section className="career-ats-card" aria-labelledby="career-ats-title">
      <header>
        <div>
          <span>ATS-читаемость</span>
          <h3 id="career-ats-title">
            {findings.length
              ? `${known} из ${findings.length} проверок с фактом`
              : 'Нужен исходный CV'}
          </h3>
        </div>
        {findings.some((finding) => finding.status === 'issue') ? (
          <WarningCircle size={20} />
        ) : (
          <CheckCircle size={20} />
        )}
      </header>
      {findings.length ? (
        <dl>
          {findings.map((finding) => (
            <div key={finding.id}>
              <dt>{findingLabel(finding.dimension)}</dt>
              <dd className={`is-${finding.status}`}>{finding.title}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Загрузите PDF или DOCX: без исходной вёрстки нельзя честно оценить порядок чтения.</p>
      )}
      <button className="career-inline-link" type="button" onClick={onOpenProfile}>
        {findings.length ? 'Открыть разбор' : 'Добавить документ'} <ArrowRight size={15} />
      </button>
    </section>
  );
}

function MarketAnalytics({ subscription }: { subscription: VacancySubscription }) {
  const analytics = subscription.analytics;
  const primaryCurrency = analytics.currencies[0];
  return (
    <>
      <dl className="career-market-metrics">
        <div>
          <dt>Найдено в последней выборке</dt>
          <dd>{analytics.sourceFound ?? '—'}</dd>
        </div>
        <div>
          <dt>Зарплата указана</dt>
          <dd>
            {analytics.salaryKnown} из {analytics.sampleSize}
          </dd>
        </div>
        <div>
          <dt>Медиана вилки</dt>
          <dd>{primaryCurrency ? salaryMedian(primaryCurrency) : 'Нет данных'}</dd>
        </div>
        <div>
          <dt>Главная локация</dt>
          <dd>{analytics.topLocations[0]?.location ?? 'Нет данных'}</dd>
        </div>
      </dl>
      <p className="career-market-freshness">
        {analytics.observedTo
          ? `Наблюдения: ${dateLabel(analytics.observedFrom)} — ${dateLabel(analytics.observedTo)}`
          : 'Наблюдений пока нет'}
        {' · '}неизвестная зарплата: {analytics.unknownSalary}
      </p>
    </>
  );
}

function NextAction({
  journey,
  onNavigate,
}: {
  journey?: CareerJourney;
  onNavigate: (view: 'profile' | 'career' | 'opportunities') => void;
}) {
  const destination = journey?.nextAction.destination ?? 'profile';
  const supportedDestination = destination === 'today' ? 'profile' : destination;
  return (
    <section className="career-next-action-card">
      <span>Следующее действие</span>
      <h3>{journey?.nextAction.headline ?? 'Уточнить основу профиля'}</h3>
      <p>
        {journey?.nextAction.reason ??
          'Добавьте CV или ответьте стратегу: следующий шаг появится только после проверяемого факта.'}
      </p>
      <button type="button" onClick={() => onNavigate(supportedDestination)}>
        {journey?.nextAction.label ?? 'Открыть профиль'} <ArrowRight size={16} />
      </button>
    </section>
  );
}

function salaryMedian(currency: VacancySubscription['analytics']['currencies'][number]) {
  const value = currency.medianFrom ?? currency.medianTo;
  if (value === null) return 'Нет данных';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ${currency.currency}`;
}

function cadenceLabel(minutes: number) {
  if (minutes % 1_440 === 0) return `${minutes / 1_440} дн.`;
  if (minutes % 60 === 0) return `${minutes / 60} ч.`;
  return `${minutes} мин.`;
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function findingLabel(dimension: CareerJourney['diagnostic']['findings'][number]['dimension']) {
  return {
    readability: 'Извлечение текста',
    ats: 'Структура и формат',
    evidence: 'Доказательность',
    freshness: 'Актуальность',
    contradictions: 'Расхождения',
    market: 'Рыночная проверка',
  }[dimension];
}

function intelligenceError(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) {
    return reason.message;
  }
  return 'Не удалось обновить рыночную выборку. Поиск сохранён.';
}
