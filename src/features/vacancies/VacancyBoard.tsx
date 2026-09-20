import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { useMemo, useState } from 'react';
import { ArrowSquareOut, ListDashes, MapPin, Sparkle, Target, Users } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { RecruiterContact } from '../../../shared/recruiterContact';
import { VacancyPitchModal } from './VacancyPitchModal';
import { DesktopOutreachModal } from '../outreach/DesktopOutreachModal';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import type { CandidateMemory } from '../coach/coachApi';
import { RecruiterContactsBlock } from './RecruiterContactsBlock';
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
import { VacancyMapView } from './VacancyMapView';
import {
  calculateVacancyFacets,
  type VacancyFacetCounts,
} from './vacancyFacets';

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
/** Страница списка вакансий (B232): 20 строк, дальше — по просьбе. */
const VACANCY_PAGE_SIZE = 20;

const FRESHNESS_CHOICES: ReadonlyArray<{ label: string; days?: number }> = [
  { label: 'до 7 дней', days: 7 },
  { label: 'до 30 дней', days: 30 },
  { label: 'любая', days: undefined },
];

// Экран пула — одна таблица с фильтрами: разнесение шапки, строк и подвала по
// файлам только спрятало бы порядок колонок.
// eslint-disable-next-line max-lines-per-function
export function VacancyBoard({
  candidateId,
  subscriptions = [],
  defaultQuery,
  onRefresh,
  pool,
  applications,
  initialContactsByVacancyId,
  candidateFacts,
}: {
  readonly candidateId?: string;
  /** Регулярные выборки кандидата: заводятся здесь же, в панели фильтров (B181). */
  readonly subscriptions?: readonly VacancySubscription[];
  readonly defaultQuery?: string;
  readonly onRefresh?: () => Promise<void>;
  /** Пул, прочитанный кабинетом один раз на все разделы (B104). */
  readonly pool?: MatchedPool;
  /** Ручные отклики кандидата (B165, срез 1); передаются в тестах и с сервера. */
  readonly applications?: readonly VacancyApplication[];
  /** Начальные контакты нанимателей по id кластера вакансии (B223). */
  readonly initialContactsByVacancyId?: Record<string, readonly RecruiterContact[]>;
  /** Подтверждённые факты кандидата для подготовки к интервью (B226). */
  readonly candidateFacts?: readonly CandidateMemory[];
} = {}) {
  const { matched, total, poolTotal, loading, failed } = useMatchedPool(pool);
  const vacancyApplications = useVacancyApplications(applications);
  // Пока пул дочитывается, счётчик называет прочитанное, а не обещанное.
  const counted = total || matched.length;
  const filling = total === 0 && matched.length > 0;
  const state = <VacancyBoardState loading={loading} failed={failed} empty={matched.length === 0} />;
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [filters, setFilters] = useState<VacancyFilters>({});
  const [pitchVacancy, setPitchVacancy] = useState<MatchedVacancyItem['cluster'] | null>(null);
  const [outreachVacancy, setOutreachVacancy] = useState<MatchedVacancyItem['cluster'] | null>(null);
  const [prepVacancy, setPrepVacancy] = useState<MatchedVacancyItem['cluster'] | null>(null);
  // Момент расчёта возраста берётся один раз на прочитанный пул: пересчёт на
  // каждый рендер сдвигал бы возраст записей под курсором.
  const poolKey = `${matched.length}:${matched.at(-1)?.cluster.id ?? ''}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date().toISOString(), [poolKey]);
  const facets = useMemo(() => calculateVacancyFacets(matched), [matched]);
  const shown = useMemo(
    () => filterVacancies(matched, filters, now),
    [matched, filters, now],
  );
  const sources = useMemo(() => vacancySourceNames(matched), [matched]);
  // Страница списка: подбор в 96–397 записей, отрисованный целиком, давал
  // 5 108 текстовых узлов на одном экране (B232). Смена фильтров возвращает
  // к первой странице — иначе «показано 40 из 12» после сужения выборки.
  const [visibleCount, setVisibleCount] = useState(VACANCY_PAGE_SIZE);
  const applyFilters = (next: VacancyFilters) => {
    setFilters(next);
    setVisibleCount(VACANCY_PAGE_SIZE);
  };
  const visible = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);
  const remaining = Math.max(0, shown.length - visible.length);

  // Панель фильтров стоит на экране всегда: регулярные выборки живут в ней, и
  // пустой пул — ровно тот случай, когда кандидату надо завести первую (B181).
  const asidePanel = (
    <VacancyFilterPanel
      filters={filters}
      facets={facets}
      sources={sources}
      onChange={applyFilters}
      onReset={() => applyFilters({})}
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
          <div className="career-vacancy-view-switcher" role="radiogroup" aria-label="Режим отображения">
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'list'}
              className={`career-tab-btn ${viewMode === 'list' ? 'is-active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <ListDashes size={14} aria-hidden="true" />
              <span>Список ({shown.length})</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'map'}
              className={`career-tab-btn ${viewMode === 'map' ? 'is-active' : ''}`}
              onClick={() => setViewMode('map')}
            >
              <MapPin size={14} aria-hidden="true" />
              <span>На карте ({facets.onMap.count} из {facets.total})</span>
            </button>
          </div>
          <VacancyChips filters={filters} onChange={applyFilters} />
        </header>
        {viewMode === 'map' ? (
          <VacancyMapView
            items={shown}
            selectedCity={filters.city}
            onSelectCity={(city) => applyFilters({ ...filters, city })}
          />
        ) : (
          <div className="career-vacancy-table">
            <div className="career-vacancy-columns" aria-hidden="true">
              <span>вакансия</span>
              <span>зарплата</span>
              <span>локация</span>
              <span>возраст</span>
              <span>покрытие</span>
            </div>
            <ol className="career-vacancy-list">
              {visible.map((item) => (
                <VacancyRow
                  key={item.cluster.id}
                  item={item}
                  now={now}
                  applications={vacancyApplications}
                  onPreparePitch={setPitchVacancy}
                  onOpenOutreach={setOutreachVacancy}
                  onPrepareInterview={setPrepVacancy}
                  initialContacts={initialContactsByVacancyId?.[item.cluster.id]}
                />
              ))}
            </ol>
            {shown.length === 0 ? (
              <p className="career-market-empty">
                Под эти фильтры не подходит ни одна запись пула.
              </p>
            ) : null}
            {remaining > 0 ? (
              <div className="career-vacancy-more">
                <span className="career-vacancy-more-count" aria-live="polite">
                  показано {visible.length} из {shown.length}
                </span>
                <button
                  type="button"
                  className="career-btn career-btn-secondary"
                  onClick={() => setVisibleCount((count) => count + VACANCY_PAGE_SIZE)}
                >
                  Показать ещё {Math.min(VACANCY_PAGE_SIZE, remaining)}
                </button>
              </div>
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
        )}
      </div>
      {pitchVacancy ? (
        <VacancyPitchModal
          isOpen={Boolean(pitchVacancy)}
          onClose={() => setPitchVacancy(null)}
          onOpenOutreach={() => {
            const cur = pitchVacancy;
            setPitchVacancy(null);
            setOutreachVacancy(cur);
          }}
          vacancy={{
            id: pitchVacancy.id,
            title: pitchVacancy.canonicalTitle,
            company: pitchVacancy.canonicalCompany,
            location: pitchVacancy.canonicalLocation,
            isRemote: pitchVacancy.isRemote,
            skills: pitchVacancy.skills,
            descriptionSummary: pitchVacancy.descriptionSummary,
          }}
        />
      ) : null}
      {outreachVacancy ? (
        <DesktopOutreachModal
          isOpen={Boolean(outreachVacancy)}
          onClose={() => setOutreachVacancy(null)}
          candidateId={candidateId}
          vacancy={{
            id: outreachVacancy.id,
            title: outreachVacancy.canonicalTitle,
            company: outreachVacancy.canonicalCompany,
            location: outreachVacancy.canonicalLocation,
            isRemote: outreachVacancy.isRemote,
            skills: outreachVacancy.skills,
          }}
        />
      ) : null}
      {prepVacancy ? (
        <InterviewPrepModal
          isOpen={Boolean(prepVacancy)}
          onClose={() => setPrepVacancy(null)}
          vacancy={{
            id: prepVacancy.id,
            title: prepVacancy.canonicalTitle,
            company: prepVacancy.canonicalCompany,
            location: prepVacancy.canonicalLocation,
            isRemote: prepVacancy.isRemote,
            skills: prepVacancy.skills,
            descriptionSummary: prepVacancy.descriptionSummary,
          }}
          facts={candidateFacts}
        />
      ) : null}
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
  facets,
  sources,
  onChange,
  onReset,
  subscriptions,
  defaultQuery,
  onRefresh,
}: {
  filters: VacancyFilters;
  facets: VacancyFacetCounts;
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

      <RemoteFormatFilter
        remoteOnly={filters.remoteOnly}
        onToggle={() => onChange({ ...filters, remoteOnly: !filters.remoteOnly })}
      />

      <FeatureFacetsFilter filters={filters} facets={facets} onChange={onChange} />

      <SourceFilter filters={filters} sources={sources} onChange={onChange} />
    </aside>
  );
}

function FeatureFacetsFilter({
  filters,
  facets,
  onChange,
}: {
  filters: VacancyFilters;
  facets: VacancyFacetCounts;
  onChange: (filters: VacancyFilters) => void;
}) {
  return (
    <fieldset>
      <legend>Фишки работодателей</legend>
      <div className="career-vacancy-chips">
        <button
          type="button"
          className={filters.relocationOnly ? 'is-active' : ''}
          aria-pressed={Boolean(filters.relocationOnly)}
          onClick={() => onChange({ ...filters, relocationOnly: !filters.relocationOnly })}
        >
          Релокация ({facets.relocation.count} из {facets.total})
        </button>
        <button
          type="button"
          className={filters.currencyRemoteOnly ? 'is-active' : ''}
          aria-pressed={Boolean(filters.currencyRemoteOnly)}
          onClick={() => onChange({ ...filters, currencyRemoteOnly: !filters.currencyRemoteOnly })}
        >
          Валюта ({facets.currencyRemote.count} из {facets.total})
        </button>
        <button
          type="button"
          className={filters.russianAbroadOnly ? 'is-active' : ''}
          aria-pressed={Boolean(filters.russianAbroadOnly)}
          onClick={() => onChange({ ...filters, russianAbroadOnly: !filters.russianAbroadOnly })}
        >
          Рос. за рубежом ({facets.russianAbroad.count} из {facets.total})
        </button>
      </div>
    </fieldset>
  );
}

function RemoteFormatFilter({
  remoteOnly,
  onToggle,
}: {
  remoteOnly?: boolean;
  onToggle: () => void;
}) {
  return (
    <fieldset>
      <legend>Формат</legend>
      <div className="career-vacancy-chips">
        <button
          type="button"
          className={remoteOnly ? 'is-active' : ''}
          aria-pressed={Boolean(remoteOnly)}
          onClick={onToggle}
        >
          Только удалённо
        </button>
      </div>
    </fieldset>
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
  if (filters.relocationOnly) chips.push({ key: 'relocationOnly', label: 'Релокация' });
  if (filters.currencyRemoteOnly) chips.push({ key: 'currencyRemoteOnly', label: 'Валютная удалёнка' });
  if (filters.russianAbroadOnly) chips.push({ key: 'russianAbroadOnly', label: 'Рос. за рубежом' });
  if (filters.city) chips.push({ key: 'city', label: `Город: ${filters.city}` });
  if (filters.industry) chips.push({ key: 'industry', label: `Индустрия: ${filters.industry}` });
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

function VacancyFeatureBadges({
  features,
}: {
  features?: MatchedVacancyItem['cluster']['companyFeatures'];
}) {
  if (!features) return null;
  const badges: string[] = [];
  if (features.relocation) badges.push('✈️ Релокация');
  if (features.currencyRemote) badges.push('💵 Валюта');
  if (features.russianAbroad) badges.push('🌍 Рос. за рубежом');
  if (features.atsProvider) badges.push(`ATS: ${features.atsProvider}`);
  if (badges.length === 0) return null;

  return (
    <span className="career-vacancy-feature-badges">
      {badges.map((b) => (
        <span key={b} className="career-feature-badge">
          {b}
        </span>
      ))}
    </span>
  );
}

// Строка таблицы — шесть колонок макета подряд.
// eslint-disable-next-line max-lines-per-function
function VacancyRow({
  item,
  now,
  applications,
  onPreparePitch,
  onOpenOutreach,
  onPrepareInterview,
  initialContacts,
}: {
  item: MatchedVacancyItem;
  now: string;
  applications: VacancyApplications;
  onPreparePitch?: (cluster: MatchedVacancyItem['cluster']) => void;
  onOpenOutreach?: (cluster: MatchedVacancyItem['cluster']) => void;
  onPrepareInterview?: (cluster: MatchedVacancyItem['cluster']) => void;
  initialContacts?: readonly RecruiterContact[];
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
        <VacancyFeatureBadges features={cluster.companyFeatures} />
        </span>
      </div>
      <span className="career-vacancy-salary">{salaryLabel(cluster.salary)}</span>
      <span className="career-vacancy-location">
        {cluster.canonicalLocation || (cluster.isRemote ? 'Удалённо' : 'Не указана')}
        {explanation.outsideGeography ? (
          <small className="career-vacancy-outside">вне вашей географии</small>
        ) : null}
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
        {onPreparePitch ? (
          <button
            type="button"
            className="career-vacancy-pitch-btn"
            onClick={() => onPreparePitch(cluster)}
            title="Подготовить контекстное сопроводительное письмо и питч"
          >
            <Sparkle size={14} aria-hidden="true" />
            <span>Подготовить отклик</span>
          </button>
        ) : null}
        {onOpenOutreach ? (
          <button
            type="button"
            className="career-vacancy-outreach-btn"
            onClick={() => onOpenOutreach(cluster)}
            title="Поиск связей и прямой аутрич через LinkedIn"
          >
            <Users size={14} aria-hidden="true" />
            <span>Нетворкинг</span>
          </button>
        ) : null}
        {onPrepareInterview ? (
          <button
            type="button"
            className="career-vacancy-prep-btn"
            onClick={() => onPrepareInterview(cluster)}
            title="Подготовка к интервью по методу STAR"
          >
            <Target size={14} aria-hidden="true" />
            <span>К интервью</span>
          </button>
        ) : null}
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
      <RecruiterContactsBlock
        vacancyId={cluster.id}
        initialContacts={initialContacts}
        vacancyPayload={{
          id: cluster.id,
          title: cluster.canonicalTitle,
          company: cluster.canonicalCompany ?? '',
          url: cluster.primaryUrl,
          description: cluster.descriptionSummary,
        }}
      />
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
  // Неразрывный пробел: в узкой колонке «₽» отрывался на свою строку (B232).
  return `${[from, to].filter(Boolean).join(' ')}\u00a0${currency}`.trim();
}
