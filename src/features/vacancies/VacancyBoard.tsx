import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { useMemo, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { employerLabel } from '../../../shared/employerLabel';
import {
  filterVacancies,
  vacancyAge,
  vacancyCoverage,
  vacancySourceNames,
  type VacancyFilters,
} from './vacancyFilters';
import { useMatchedPool, type MatchedPool } from './useMatchedPool';
import { useVacancyApplications, type VacancyApplications } from './useVacancyApplications';
import type { VacancyApplication } from '../../../shared/vacancyApplication';
import { SavedSearchesPanel } from './SavedSearchesPanel';
import type { VacancySubscription } from '../coach/coachApi';

/**
 * «Вакансии» — весь собранный пул с фильтрами («Пульт»).
 *
 * Раньше рынок жил одним разделом «Возможности», где список из четырёх строк
 * стоял под настройками регулярного поиска: кандидат не мог ни отфильтровать
 * пул, ни увидеть его размер, ни понять, свежая запись или месячной давности.
 * Кампания осталась в «Поиске», а сюда переехал сам пул.
 *
 * Ни одного процента: покрытие — счёт требований, возраст — дни с первого
 * наблюдения, и то и другое с датой расчёта. Проценты соответствия без
 * источника, выборки и даты — отдельная находка аудита B178, и повторять её
 * здесь нельзя.
 */
const FRESHNESS_CHOICES: ReadonlyArray<{ label: string; days?: number }> = [
  { label: 'до 7 дней', days: 7 },
  { label: 'до 30 дней', days: 30 },
  { label: 'любая', days: undefined },
];

// Экран пула — одна таблица с фильтрами: разнесение шапки, строк и подвала по
// файлам только спрятало бы порядок колонок.
// eslint-disable-next-line max-lines-per-function
export function VacancyBoard({
  subscriptions = [],
  defaultQuery,
  onRefresh,
  pool,
  applications,
}: {
  /** Регулярные выборки кандидата: заводятся здесь же, в панели фильтров (B181). */
  readonly subscriptions?: readonly VacancySubscription[];
  readonly defaultQuery?: string;
  readonly onRefresh?: () => Promise<void>;
  /** Пул, прочитанный кабинетом один раз на все разделы (B104). */
  readonly pool?: MatchedPool;
  /** Ручные отклики кандидата (B165, срез 1); передаются в тестах и с сервера. */
  readonly applications?: readonly VacancyApplication[];
} = {}) {
  const { matched, total, poolTotal, loading, failed } = useMatchedPool(pool);
  const vacancyApplications = useVacancyApplications(applications);
  // Пока пул дочитывается, счётчик называет прочитанное, а не обещанное.
  const counted = total || matched.length;
  const filling = total === 0 && matched.length > 0;
  const state = <VacancyBoardState loading={loading} failed={failed} empty={matched.length === 0} />;
  const [filters, setFilters] = useState<VacancyFilters>({});
  // Момент расчёта возраста берётся один раз на прочитанный пул: пересчёт на
  // каждый рендер сдвигал бы возраст записей под курсором.
  const poolKey = `${matched.length}:${matched.at(-1)?.cluster.id ?? ''}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date().toISOString(), [poolKey]);
  const shown = useMemo(
    () => filterVacancies(matched, filters, now),
    [matched, filters, now],
  );
  const sources = useMemo(() => vacancySourceNames(matched), [matched]);

  // Панель фильтров стоит на экране всегда: регулярные выборки живут в ней, и
  // пустой пул — ровно тот случай, когда кандидату надо завести первую (B181).
  const asidePanel = (
    <VacancyFilterPanel
      filters={filters}
      sources={sources}
      onChange={setFilters}
      onReset={() => setFilters({})}
      subscriptions={subscriptions}
      defaultQuery={defaultQuery}
      onRefresh={onRefresh}
    />
  );

  if (loading || failed || matched.length === 0) {
    return (
      <div className="career-vacancy-board">
        {asidePanel}
        <div className="career-vacancy-main">{state}</div>
      </div>
    );
  }

  return (
    <div className="career-vacancy-board">
      {asidePanel}
      <div className="career-vacancy-main">
        <header className="career-vacancy-head">
          <p className="career-vacancy-count">
            <strong>{counted}</strong> в подборе{filling ? ` из ${poolTotal}, дочитываем` : ''} ·{' '}
            <strong>{freshToday(matched, now)}</strong> собрано сегодня ·{' '}
            <strong>{shown.length}</strong> после фильтров
          </p>
          <VacancyChips filters={filters} onChange={setFilters} />
        </header>
        <div className="career-vacancy-table">
          <div className="career-vacancy-columns" aria-hidden="true">
            <span>вакансия</span>
            <span>зарплата</span>
            <span>локация</span>
            <span>возраст</span>
            <span>покрытие</span>
            <span />
          </div>
          <ol className="career-vacancy-list">
            {shown.map((item) => (
              <VacancyRow
                key={item.cluster.id}
                item={item}
                now={now}
                applications={vacancyApplications}
              />
            ))}
          </ol>
          {shown.length === 0 ? (
            <p className="career-market-empty">
              Под эти фильтры не подходит ни одна запись пула.
            </p>
          ) : null}
          <footer className="career-vacancy-foot">
            <span className="career-cabinet-tag">
              {sources.length} {sourceNoun(sources.length)} в подборе
            </span>
            <span className="career-cabinet-tag">
              последняя запись собрана {lastCollected(matched)}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Три состояния до списка: читаем, не прочитали, честно пусто. */
function VacancyBoardState({
  loading,
  failed,
  empty,
}: {
  loading: boolean;
  failed: boolean;
  empty: boolean;
}) {
  if (loading) {
    return (
      <p className="career-cabinet-loading" aria-busy="true">
        Читаем собранный пул вакансий…
      </p>
    );
  }
  if (failed) {
    return (
      <p className="career-expert-error" role="alert">
        Пул вакансий сейчас не читается — источник не ответил. Данные профиля не
        затронуты, повторите позже.
      </p>
    );
  }
  if (empty) {
    return (
      <p className="career-market-empty">
        Пул пуст для вашего профиля. Подбор работает по подтверждённым навыкам и
        названной роли: пока их нет, продукт не показывает вакансии, чтобы не
        выдавать случайные записи за подходящие.
      </p>
    );
  }
  return null;
}

function VacancyFilterPanel({
  filters,
  sources,
  onChange,
  onReset,
  subscriptions,
  defaultQuery,
  onRefresh,
}: {
  filters: VacancyFilters;
  sources: ReadonlyArray<{ source: string; count: number }>;
  onChange: (filters: VacancyFilters) => void;
  onReset: () => void;
  subscriptions: readonly VacancySubscription[];
  defaultQuery?: string;
  onRefresh?: () => Promise<void>;
}) {
  return (
    <aside className="career-vacancy-filters" aria-label="Фильтры вакансий">
      <SavedSearchesPanel
        subscriptions={subscriptions}
        defaultQuery={defaultQuery}
        onRefresh={onRefresh ?? (async () => undefined)}
      />

      <header>
        <h3>Фильтры</h3>
        <button className="career-inline-link" type="button" onClick={onReset}>
          Сбросить
        </button>
      </header>

      <VacancyQueryFilter filters={filters} onChange={onChange} />

      <FreshnessFilter filters={filters} onChange={onChange} />

      <fieldset>
        <legend>Формат</legend>
        <div className="career-vacancy-chips">
          <button
            type="button"
            className={filters.remoteOnly ? 'is-active' : ''}
            aria-pressed={Boolean(filters.remoteOnly)}
            onClick={() => onChange({ ...filters, remoteOnly: !filters.remoteOnly })}
          >
            Только удалённо
          </button>
        </div>
      </fieldset>

      <SourceFilter filters={filters} sources={sources} onChange={onChange} />
    </aside>
  );
}

function VacancyQueryFilter({
  filters,
  onChange,
}: {
  filters: VacancyFilters;
  onChange: (filters: VacancyFilters) => void;
}) {
  return (
    <label className="career-vacancy-search">
      <span>Название или работодатель</span>
      <input
        type="search"
        value={filters.query ?? ''}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
        placeholder="Аналитик, FinCloud…"
      />
    </label>
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
  filters: VacancyFilters;
  onChange: (filters: VacancyFilters) => void;
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
        Считается от первого сбора записи, а не от даты публикации — её источники
        отдают не всегда.
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
  filters: VacancyFilters;
  sources: ReadonlyArray<{ source: string; count: number }>;
  onChange: (filters: VacancyFilters) => void;
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

/** Активные фильтры — чипами, каждый снимается по себе (макет «Пульт»). */
function VacancyChips({
  filters,
  onChange,
}: {
  filters: VacancyFilters;
  onChange: (next: VacancyFilters) => void;
}) {
  const chips: Array<{ key: keyof VacancyFilters; label: string }> = [];
  if (filters.query) chips.push({ key: 'query', label: filters.query });
  if (filters.source) {
    chips.push({ key: 'source', label: filters.source });
  }
  if (filters.remoteOnly) chips.push({ key: 'remoteOnly', label: 'Только удалённо' });
  if (filters.freshness !== undefined) {
    chips.push({ key: 'freshness', label: `до ${filters.freshness} дней` });
  }
  if (chips.length === 0) return null;

  return (
    <ul className="career-vacancy-active-filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            onClick={() => onChange({ ...filters, [chip.key]: undefined })}
            aria-label={`Снять фильтр: ${chip.label}`}
          >
            {chip.label} ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Сколько записей пул собрал сегодня — по дате первого сбора, не публикации. */
function freshToday(items: readonly MatchedVacancyItem[], now: string): number {
  const today = now.slice(0, 10);
  return items.filter((item) => (item.cluster.firstObservedAt ?? '').slice(0, 10) === today)
    .length;
}

function lastCollected(items: readonly MatchedVacancyItem[]): string {
  const latest = items
    .map((item) => item.cluster.lastSeenAt ?? item.cluster.firstObservedAt ?? '')
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latest) return 'дата неизвестна';
  return new Date(latest).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function sourceNoun(count: number): string {
  const tail = count % 10;
  const teen = count % 100;
  if (teen >= 11 && teen <= 14) return 'источников';
  if (tail === 1) return 'источник';
  if (tail >= 2 && tail <= 4) return 'источника';
  return 'источников';
}

// Строка таблицы — шесть колонок макета подряд.
// eslint-disable-next-line max-lines-per-function
function VacancyRow({
  item,
  now,
  applications,
}: {
  item: MatchedVacancyItem;
  now: string;
  applications: VacancyApplications;
}) {
  const { cluster, explanation } = item;
  const age = vacancyAge(cluster, now);
  const coverage = vacancyCoverage(explanation);
  const application = applications.byCluster.get(cluster.id);
  const snapshot = {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany ?? '',
    url: cluster.primaryUrl,
    source: cluster.sources[0]?.sourceId ?? '',
  };

  return (
    <li className="career-vacancy-row">
      <div className="career-vacancy-title">
        <span className="career-job-logo" aria-hidden="true">
          {employerInitials(cluster.canonicalCompany)}
        </span>
        <span>
        <strong>{cluster.canonicalTitle}</strong>
        <small>
          {employerLabel(cluster.canonicalCompany)} ·{' '}
          {vacancySourceLabels(cluster.sources).join(', ')}
        </small>
        </span>
      </div>
      <span className="career-vacancy-salary">{salaryLabel(cluster.salary)}</span>
      <span className="career-vacancy-location">
        {cluster.canonicalLocation || (cluster.isRemote ? 'Удалённо' : 'Не указана')}
      </span>
      <span className="career-vacancy-age">{age.label}</span>
      <span className="career-vacancy-coverage">
        {coverage ? (
          <>
            <span
              className="career-measure-track"
              role="img"
              aria-label={`Покрытие требований: ${coverage.covered} из ${coverage.total}`}
            >
              <span
                className="career-measure-fill"
                data-share={String(
                  Math.round((coverage.covered / Math.max(1, coverage.total)) * 10) * 10,
                )}
              />
            </span>
            <strong>
              {coverage.covered} из {coverage.total}
            </strong>
          </>
        ) : (
          <small>сравнивать не с чем</small>
        )}
      </span>
      <div className="career-vacancy-actions">
        <a
          className="career-vacancy-open"
          href={cluster.primaryUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => applications.record(cluster.id, 'opened', snapshot)}
        >
          Открыть <ArrowSquareOut size={14} />
        </a>
        {application?.status === 'applied' ? (
          <span className="career-vacancy-applied">
            Отклик подтверждён {confirmedOn(application.appliedAt)}
          </span>
        ) : (
          <button
            type="button"
            className="career-inline-link"
            onClick={() => applications.record(cluster.id, 'applied', snapshot)}
          >
            Я откликнулся
          </button>
        )}
        {applications.unsaved.has(cluster.id) ? (
          <span className="career-vacancy-unsaved" role="status">
            Не сохранилось — повторите
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Дата подтверждения, а не значок: «откликнулся» без даты через неделю ничего
 * не говорит кандидату, а воронка считается по датам.
 */
function confirmedOn(appliedAt: string | null): string {
  if (!appliedAt) return 'сегодня';
  return new Date(appliedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function employerInitials(name?: string): string {
  const clean = (name ?? '').trim();
  if (!clean) return '—';
  return (
    clean
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase('ru-RU') ?? '')
      .join('') || '—'
  );
}

function salaryLabel(salary: MatchedVacancyItem['cluster']['salary']): string {
  if (!salary || (salary.from === undefined && salary.to === undefined)) {
    return 'не указана';
  }
  const currency = salary.currency ?? '';
  const from = salary.from ? `от ${salary.from.toLocaleString('ru-RU')}` : '';
  const to = salary.to ? `до ${salary.to.toLocaleString('ru-RU')}` : '';
  return `${[from, to].filter(Boolean).join(' ')} ${currency}`.trim();
}

