import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { useMemo, useState } from 'react';
import {
  ArrowSquareOut,
  ChalkboardTeacher,
  CheckCircle,
  Info,
  ListDashes,
  MapPin,
  PencilSimpleLine,
  Users,
} from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { RecruiterContact } from '../../../shared/recruiterContact';
import { VacancyPitchModal } from './VacancyPitchModal';
import { DesktopOutreachModal } from '../outreach/DesktopOutreachModal';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import type { CandidateMemory } from '../coach/coachApi';
import {
  RecruiterContactsResults,
  RecruiterContactsTrigger,
  useRecruiterContacts,
} from './RecruiterContactsBlock';
import { employerLabel } from '../../../shared/employerLabel';
import {
  IN_BASE_HINT,
  REQUIREMENTS_HINT,
  filterVacancies,
  vacancyAge,
  vacancyCountries,
  vacancyCoverage,
  vacancySourceNames,
  type VacancyFilters,
} from './vacancyFilters';
import { useMatchedPool, type MatchedPool } from './useMatchedPool';
import { useVacancyApplications, type VacancyApplications } from './useVacancyApplications';
import type { VacancyApplication } from '../../../shared/vacancyApplication';
import { VacancyFilterPanel } from './VacancyFilterPanel';
import type { VacancySubscription } from '../coach/coachApi';
import { VacancyMapView } from './VacancyMapView';
import { calculateVacancyFacets } from './vacancyFacets';
import { VACANCY_CONDITIONS, VacancyConditionBadges } from './vacancyConditions';
import { openTargetLabel } from './vacancyOpenTarget';
import { CareerTooltip } from '../shell/CareerTooltip';

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
  const state = (
    <VacancyBoardState loading={loading} failed={failed} empty={matched.length === 0} />
  );
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [filters, setFilters] = useState<VacancyFilters>({});
  const [pitchVacancy, setPitchVacancy] = useState<MatchedVacancyItem['cluster'] | null>(null);
  const [outreachVacancy, setOutreachVacancy] = useState<MatchedVacancyItem['cluster'] | null>(
    null,
  );
  const [prepVacancy, setPrepVacancy] = useState<MatchedVacancyItem['cluster'] | null>(null);
  // Момент расчёта возраста берётся один раз на прочитанный пул: пересчёт на
  // каждый рендер сдвигал бы возраст записей под курсором.
  const poolKey = `${matched.length}:${matched.at(-1)?.cluster.id ?? ''}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date().toISOString(), [poolKey]);
  const facets = useMemo(() => calculateVacancyFacets(matched), [matched]);
  const shown = useMemo(() => filterVacancies(matched, filters, now), [matched, filters, now]);
  const sources = useMemo(() => vacancySourceNames(matched), [matched]);
  const countries = useMemo(() => vacancyCountries(matched), [matched]);
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
      countries={countries}
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
            <strong>{counted}</strong> подобрано{filling ? ` из ${poolTotal}, загружаем` : ''} ·{' '}
            <strong>{freshToday(matched, now)}</strong> новых сегодня · показано{' '}
            <strong>{shown.length}</strong>
          </p>
          <div
            className="career-vacancy-view-switcher"
            role="radiogroup"
            aria-label="Режим отображения"
          >
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
              <span>
                На карте ({facets.onMap.count} из {facets.total})
              </span>
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
            <div className="career-vacancy-columns">
              <span>вакансия</span>
              <span>зарплата</span>
              <span>локация</span>
              <CareerTooltip content={IN_BASE_HINT}>
                <button type="button" className="career-vacancy-column-hint">
                  в базе <Info size={12} aria-hidden="true" />
                </button>
              </CareerTooltip>
              <CareerTooltip content={REQUIREMENTS_HINT}>
                <button type="button" className="career-vacancy-column-hint">
                  требования
                </button>
              </CareerTooltip>
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
                Под эти фильтры ничего не подошло. Снимите часть фильтров.
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
                  Показать ещё {Math.min(VACANCY_PAGE_SIZE, remaining)} вакансий
                </button>
              </div>
            ) : null}
            <footer className="career-vacancy-foot">
              <span className="career-cabinet-tag">
                {sources.length} {sourceNoun(sources.length)} в подборе
              </span>
              <span className="career-cabinet-tag">последний сбор {lastCollected(matched)}</span>
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
        Загружаем вакансии…
      </p>
    );
  }
  if (failed) {
    return (
      <p className="career-expert-error" role="alert">
        Не удалось загрузить вакансии — сервер не ответил. Профиль цел. Повторите через минуту.
      </p>
    );
  }
  if (empty) {
    return (
      <p className="career-market-empty">
        Подходящих вакансий пока нет. Подбор идёт по выбранной роли и подтверждённым навыкам: пока
        их нет в профиле, мы не показываем случайные вакансии как подходящие. Выберите роль на
        Главной или добавьте резюме.
      </p>
    );
  }
  return null;
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
  if (filters.role) chips.push({ key: 'role', label: `Роль: ${filters.role}` });
  if (filters.country) chips.push({ key: 'country', label: filters.country });
  if (filters.source) {
    chips.push({ key: 'source', label: filters.source });
  }
  if (filters.remoteOnly) chips.push({ key: 'remoteOnly', label: 'Удалённо' });
  if (filters.freshness !== undefined) {
    chips.push({ key: 'freshness', label: `до ${filters.freshness} дней` });
  }
  for (const condition of VACANCY_CONDITIONS) {
    if (filters[condition.filter]) chips.push({ key: condition.filter, label: condition.label });
  }
  if (filters.city) chips.push({ key: 'city', label: `Город: ${filters.city}` });
  if (filters.industry) chips.push({ key: 'industry', label: `Отрасль: ${filters.industry}` });
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
  return items.filter((item) => (item.cluster.firstObservedAt ?? '').slice(0, 10) === today).length;
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
  const recruiter = useRecruiterContacts({
    vacancyId: cluster.id,
    initialContacts,
    vacancyPayload: {
      id: cluster.id,
      title: cluster.canonicalTitle,
      company: cluster.canonicalCompany ?? '',
      url: cluster.primaryUrl,
      description: cluster.descriptionSummary,
    },
  });

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
          <VacancyConditionBadges features={cluster.companyFeatures} />
        </span>
      </div>
      <span className="career-vacancy-salary">{salaryLabel(cluster.salary)}</span>
      <span className="career-vacancy-location">
        {cluster.canonicalLocation || (cluster.isRemote ? 'Удалённо' : 'город не указан')}
        {explanation.outsideGeography ? (
          <small className="career-vacancy-outside">не в ваших регионах</small>
        ) : null}
      </span>
      <span className="career-vacancy-age">{age.label}</span>
      <span className="career-vacancy-coverage">
        {coverage ? (
          <>
            <span
              className="career-measure-track"
              role="img"
              aria-label={`Совпало требований: ${coverage.covered} из ${coverage.total}`}
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
          <CareerTooltip content="Из текста вакансии не удалось выделить требования. Сравнивать не с чем.">
            <small>требования не выделены</small>
          </CareerTooltip>
        )}
      </span>
      {/* Порядок — по ходу действий: подготовить → тёплый вход → контакт →
          открыть → отметить; «Интервью» последняя (B236 §4.4). Одна залитая
          кнопка — «Открыть на …»: отклик происходит там. Подпись короткая,
          объяснение — в тултипе. */}
      <div className="career-vacancy-actions">
        {onPreparePitch ? (
          <CareerTooltip content="Сопроводительное письмо, LinkedIn-заметка и cover letter для ATS по фактам профиля. Копируете и отправляете сами.">
            <button
              type="button"
              className="career-vacancy-action"
              onClick={() => onPreparePitch(cluster)}
            >
              <PencilSimpleLine size={14} aria-hidden="true" />
              <span>Отклик</span>
            </button>
          </CareerTooltip>
        ) : null}
        {onOpenOutreach ? (
          <CareerTooltip content="Кому написать в компании и какую заметку использовать. В веб-версии текст можно скопировать.">
            <button
              type="button"
              className="career-vacancy-action"
              onClick={() => onOpenOutreach(cluster)}
            >
              <Users size={14} aria-hidden="true" />
              <span>Нетворкинг</span>
            </button>
          </CareerTooltip>
        ) : null}
        <RecruiterContactsTrigger state={recruiter} className="career-vacancy-action" />
        <CareerTooltip content="Страница вакансии на площадке в новой вкладке. Переход попадёт в воронку.">
          <a
            className="career-vacancy-action is-lead"
            href={cluster.primaryUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => applications.record(cluster.id, 'opened', snapshot)}
          >
            <ArrowSquareOut size={14} aria-hidden="true" />
            <span>Открыть на {openTargetLabel(cluster.sources)}</span>
          </a>
        </CareerTooltip>
        {application?.status === 'applied' ? (
          <CareerTooltip content={`Отклик отмечен ${confirmedOn(application.appliedAt, 'long')}`}>
            <span className="career-vacancy-applied">
              <CheckCircle size={14} weight="fill" aria-hidden="true" />
              <span>Отклик {confirmedOn(application.appliedAt, 'short')}</span>
            </span>
          </CareerTooltip>
        ) : (
          <CareerTooltip content="Отметьте после отклика на площадке. Только так мы узнаём об отклике, а дата попадёт в воронку и follow-up.">
            <button
              type="button"
              className="career-vacancy-action"
              onClick={() => applications.record(cluster.id, 'applied', snapshot)}
            >
              <CheckCircle size={14} aria-hidden="true" />
              <span>Откликнулся</span>
            </button>
          </CareerTooltip>
        )}
        {onPrepareInterview ? (
          <CareerTooltip content="Справка о компании, ответы STAR по вашему опыту и вопросы работодателю.">
            <button
              type="button"
              className="career-vacancy-action"
              onClick={() => onPrepareInterview(cluster)}
            >
              <ChalkboardTeacher size={14} aria-hidden="true" />
              <span>Интервью</span>
            </button>
          </CareerTooltip>
        ) : null}
        {applications.unsaved.has(cluster.id) ? (
          <span className="career-vacancy-unsaved" role="status">
            Отметка не сохранилась — нажмите ещё раз
          </span>
        ) : null}
      </div>
      <RecruiterContactsResults state={recruiter} />
    </li>
  );
}

/**
 * Дата отметки, а не значок: «откликнулся» без даты через неделю ничего не
 * говорит кандидату, а воронка считается по датам. В строке — коротко
 * («2 сент.»), полная дата — в тултипе.
 */
function confirmedOn(appliedAt: string | null, form: 'short' | 'long'): string {
  if (!appliedAt) return 'сегодня';
  return new Date(appliedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: form === 'long' ? 'long' : 'short',
  });
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
