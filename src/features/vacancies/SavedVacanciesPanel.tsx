import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CaretDown, Info, MagnifyingGlass, Star, Target } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { ApplicationView } from '../applications/applicationsApi';
import { companyLookupKey, type VacancyCollectionsState } from './vacancyScreenCollections';
import { formatCompensationCompact } from './vacancyCompensation';
import { GeoFitDot, LevelFitDot } from './VacancyFitDots';
import { getSavedVacancyStates } from './savedVacancyStatesApi';
import {
  SAVED_SORT_OPTIONS,
  SAVED_STATE_OPTIONS,
  formatShortDate,
  savedClosedLabel,
  savedVacanciesView,
  savedVacancyItem,
  type SavedSort,
  type SavedStateFilter,
  type SavedVacancyEntry,
  type SavedVacancyState,
} from './savedVacanciesView';

const PAGE_SIZE = 20;
const VIEW_STORAGE_KEY = 'openqareer.savedVacancies.view';

interface StoredView {
  readonly state: SavedStateFilter;
  readonly sort: SavedSort;
}

function readStoredView(): StoredView {
  const fallback: StoredView = { state: 'all', sort: 'saved' };
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(VIEW_STORAGE_KEY) ?? 'null',
    ) as Partial<StoredView> | null;
    const state =
      SAVED_STATE_OPTIONS.find((item) => item.value === raw?.state)?.value ?? fallback.state;
    const sort =
      SAVED_SORT_OPTIONS.find((item) => item.value === raw?.sort)?.value ?? fallback.sort;
    return { state, sort };
  } catch {
    return fallback;
  }
}

function writeStoredView(view: StoredView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Выбор просто не переживёт перезагрузку — показывать нечего.
  }
}

function savedRefs(applications: readonly ApplicationView[]) {
  return applications.flatMap((item) =>
    item.clusterId
      ? [{ clusterId: item.clusterId, ...(item.vacancy?.url ? { url: item.vacancy.url } : {}) }]
      : [],
  );
}

function savedWant(
  collections: VacancyCollectionsState,
  company: string | undefined,
): SavedWant | undefined {
  if (!company) return undefined;
  const key = companyLookupKey(company);
  const known = collections.companyByName.get(key);
  return {
    known: Boolean(known),
    wanted: Boolean(known?.want),
    busy: collections.companyBusyNames.has(key),
    onToggle: (name) => void collections.toggleCompanyWant(name),
  };
}

function useSavedStates(applications: readonly ApplicationView[]) {
  const key = JSON.stringify(savedRefs(applications));
  const [states, setStates] = useState<Readonly<Record<string, SavedVacancyState>>>({});
  const [failed, setFailed] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string>();
  useEffect(() => {
    const refs = JSON.parse(key) as ReturnType<typeof savedRefs>;
    if (!refs.length) return undefined;
    const controller = new AbortController();
    getSavedVacancyStates(refs, controller.signal)
      .then((value) => {
        setStates(value);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(key);
      });
    return () => controller.abort();
  }, [key]);
  return { states, failed, pending: loadedKey !== key };
}

function toEntry(
  application: ApplicationView,
  states: Readonly<Record<string, SavedVacancyState>>,
  pending = false,
): SavedVacancyEntry {
  return {
    pending,
    id: application.id,
    title: application.vacancy?.title ?? 'Название вакансии не сохранено',
    company: application.vacancy?.company || 'Компания не указана',
    savedAt: application.stageChangedAt ?? application.createdAt,
    state: application.clusterId ? states[application.clusterId] : undefined,
  };
}

function SavedMoney({ entry }: { readonly entry: SavedVacancyEntry }) {
  const closed = savedClosedLabel(entry.state);
  const salary = entry.state?.salary;
  const known = salary && (salary.from !== undefined || salary.to !== undefined);
  // B446-r (A6): формулировки макета 4 — «без зарплаты», а не «Зарплата не указана».
  const missing = entry.pending && !entry.state ? '…' : 'без зарплаты';
  return (
    <div className="saved-row-money">
      {known ? (
        <strong>{formatCompensationCompact(salary)}</strong>
      ) : (
        <span className="saved-row-money-missing">{missing}</span>
      )}
      {closed ? <span className="saved-row-closed">{closed}</span> : null}
    </div>
  );
}

const LEVEL_LABEL = {
  ic: 'Специалист',
  lead: 'Лид',
  head: 'Head',
  vp: 'VP',
  'c-level': 'C-level',
} as const;

const LEVEL_FIT_LABEL = {
  match: 'совпадает',
  above: 'не совпадает',
  below: 'не совпадает',
  unknown: 'не указано',
} as const;

/** Вакансии нет в каталоге: одна строка «нет в каталоге» (макет 4), без «— неизвестно». */
function SavedOutOfCatalog({ label, note }: { readonly label: string; readonly note: string }) {
  return (
    <div className="saved-row-cell" data-label={label}>
      <span className="saved-row-fit">{note}</span>
    </div>
  );
}

/** Пока состояние читается — «проверяем каталог»; иначе вакансии в каталоге нет. */
function catalogNote(entry: SavedVacancyEntry): string {
  if (!entry.state && entry.pending) return 'проверяем каталог';
  return 'нет в каталоге';
}

function SavedLevel({ entry }: { readonly entry: SavedVacancyEntry }) {
  const state = entry.state;
  if (!state?.inCatalog) return <SavedOutOfCatalog label="Уровень" note={catalogNote(entry)} />;
  const levelMatch = state.levelMatch ?? 'unknown';
  return (
    <div className="saved-row-cell" data-label="Уровень">
      <span>{state.vacancyLevel ? LEVEL_LABEL[state.vacancyLevel] : 'Не указан'}</span>
      <span className="saved-row-fit">
        <span aria-hidden="true">
          <LevelFitDot levelMatch={levelMatch} />
        </span>
        <span>{LEVEL_FIT_LABEL[levelMatch]}</span>
      </span>
    </div>
  );
}

function SavedGeo({ entry }: { readonly entry: SavedVacancyEntry }) {
  const state = entry.state;
  if (!state?.inCatalog) return <SavedOutOfCatalog label="Гео" note={catalogNote(entry)} />;
  return (
    <div className="saved-row-cell" data-label="Гео">
      <span>{state.location ?? (state.isRemote ? 'Удалённо' : 'Не указано')}</span>
      <span className="saved-row-fit">
        <span aria-hidden="true">
          <GeoFitDot outsideGeo={state.outsideGeography} />
        </span>
        <span>{state.outsideGeography ? 'не совпадает' : 'совпадает'}</span>
      </span>
    </div>
  );
}

interface SavedWant {
  readonly known: boolean;
  readonly wanted: boolean;
  readonly busy: boolean;
  readonly onToggle: (company: string) => void;
}

/** B446-g4: в строке сохранённой — «Хочу в эту компанию», как в макете 4. */
function SavedWantButton({
  company,
  want,
}: {
  readonly company?: string;
  readonly want?: SavedWant;
}) {
  // B446-r (A6): место кнопки есть в каждой строке, чтобы иконки стояли одинаково.
  if (!company || !want)
    return (
      <button type="button" className="saved-row-want" aria-label="Компания не указана" disabled>
        <Target aria-hidden="true" />
      </button>
    );
  return (
    <button
      type="button"
      className="saved-row-want"
      aria-label={`${want.wanted ? 'Убрать из «Хочу»' : 'Хочу в компанию'}: ${company}`}
      aria-pressed={want.known ? want.wanted : undefined}
      aria-busy={want.busy}
      disabled={want.busy}
      onClick={() => want.onToggle(company)}
    >
      <Target weight={want.wanted ? 'fill' : 'regular'} aria-hidden="true" />
    </button>
  );
}

function SavedExpandButton({
  title,
  expanded,
  onExpand,
}: {
  readonly title: string;
  readonly expanded: boolean;
  readonly onExpand: () => void;
}) {
  return (
    <button
      type="button"
      className={expanded ? 'saved-row-want is-open' : 'saved-row-want'}
      aria-label={`${expanded ? 'Свернуть' : 'Раскрыть'}: ${title}`}
      aria-expanded={expanded}
      onClick={onExpand}
    >
      <CaretDown aria-hidden="true" />
    </button>
  );
}

/** Вакансии нет в каталоге — карточки нет; раскрытие говорит это и ведёт на площадку. */
function SavedOutOfCatalogDetail({ application }: { readonly application: ApplicationView }) {
  const url = application.vacancy?.url;
  return (
    <div className="saved-row-detail">
      <p>Вакансии нет в текущем каталоге: описание и соответствие не пересчитываются.</p>
      {url ? (
        <a className="career-btn is-sm" href={url} target="_blank" rel="noreferrer noopener">
          Открыть на площадке
        </a>
      ) : null}
    </div>
  );
}

function SavedRow({
  entry,
  application,
  busy,
  onRemove,
  want,
  onExpand,
  expanded = false,
}: {
  readonly entry: SavedVacancyEntry;
  readonly application: ApplicationView;
  readonly busy: boolean;
  readonly onRemove: (application: ApplicationView) => void;
  readonly want?: SavedWant;
  readonly onExpand: () => void;
  readonly expanded?: boolean;
}) {
  const savedDate = formatShortDate(entry.savedAt);
  return (
    <li className={entry.state?.closed ? 'saved-row is-closed' : 'saved-row'}>
      <div className="saved-row-role">
        <h3>{entry.title}</h3>
        <p>
          {entry.company}
          {savedDate ? ` · сохранено ${savedDate}` : ''}
        </p>
      </div>
      <SavedLevel entry={entry} />
      <SavedGeo entry={entry} />
      <SavedMoney entry={entry} />
      <div className="saved-row-actions">
        <button
          type="button"
          className="saved-row-star"
          aria-label={`Убрать из сохранённых: ${entry.title}`}
          aria-pressed="true"
          disabled={busy}
          onClick={() => onRemove(application)}
        >
          <Star weight="fill" aria-hidden="true" />
        </button>
        <SavedWantButton company={application.vacancy?.company} want={want} />
        <SavedExpandButton title={entry.title} expanded={expanded} onExpand={onExpand} />
      </div>
      {expanded ? <SavedOutOfCatalogDetail application={application} /> : null}
    </li>
  );
}

function SavedSelect<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <label className="companies-people-select-wrap saved-select-wrap">
      <span className="career-sr-only">{props.label}</span>
      <select
        className="companies-people-select saved-select"
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <CaretDown className="saved-select-caret" size={16} aria-hidden="true" />
    </label>
  );
}

function SavedControls(props: {
  readonly count: number;
  readonly query: string;
  readonly view: StoredView;
  readonly onQuery: (value: string) => void;
  readonly onView: (value: StoredView) => void;
}) {
  const label = `Компания или роль среди ${props.count} сохранённых`;
  return (
    <div className="saved-controls">
      <label className="companies-people-search">
        <MagnifyingGlass aria-hidden="true" />
        <input
          type="search"
          value={props.query}
          placeholder={label}
          aria-label={label}
          onChange={(event) => props.onQuery(event.target.value)}
        />
      </label>
      <SavedSelect
        label="Состояние"
        value={props.view.state}
        options={SAVED_STATE_OPTIONS}
        onChange={(state) => props.onView({ ...props.view, state })}
      />
      <SavedSelect
        label="Сортировка"
        value={props.view.sort}
        options={SAVED_SORT_OPTIONS}
        onChange={(sort) => props.onView({ ...props.view, sort })}
      />
    </div>
  );
}

function SavedEmpty({ onOpenSelection }: { readonly onOpenSelection: () => void }) {
  return (
    <div className="saved-empty">
      <p>
        Сохранённых вакансий пока нет. Отметьте звездой вакансию в подборке — она появится здесь.
      </p>
      <button type="button" className="career-vacancy-action" onClick={onOpenSelection}>
        Перейти в подборку
      </button>
    </div>
  );
}

function SavedStatus({
  collections,
  statesFailed,
}: {
  readonly collections: VacancyCollectionsState;
  readonly statesFailed: boolean;
}) {
  return (
    <>
      {collections.actionError ? <p role="alert">{collections.actionError}</p> : null}
      {collections.savedError ? (
        <div role="alert">
          <p>{collections.savedError}</p>
          <button type="button" className="career-vacancy-action" onClick={collections.retry}>
            Повторить
          </button>
        </div>
      ) : null}
      {statesFailed ? (
        <p className="saved-note">
          Не удалось проверить деньги и закрытие на площадке — показываем без них.
        </p>
      ) : null}
      {collections.savedLoading ? <p aria-live="polite">Загружаем сохранённые вакансии…</p> : null}
    </>
  );
}

function useSavedPanelState(saved: readonly ApplicationView[]) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<StoredView>(readStoredView);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { states, failed, pending } = useSavedStates(saved);
  const visible = useMemo(
    () =>
      savedVacanciesView(
        saved.map((item) => toEntry(item, states, pending)),
        { query, ...view },
      ),
    [saved, states, pending, query, view],
  );
  return {
    query,
    view,
    limit,
    visible,
    statesFailed: failed,
    changeQuery: (value: string) => {
      setQuery(value);
      setLimit(PAGE_SIZE);
    },
    changeView: (next: StoredView) => {
      setView(next);
      setLimit(PAGE_SIZE);
      writeStoredView(next);
    },
    showMore: () => setLimit((value) => value + PAGE_SIZE),
  };
}

/** B446-g4: раскрытая сохранённая — та же карточка, что в подборке; сворачивает себя сама. */
export type SavedCardRenderer = (item: MatchedVacancyItem, onCollapse: () => void) => ReactNode;

function savedItemFor(entry: SavedVacancyEntry, application: ApplicationView) {
  return savedVacancyItem(
    {
      clusterId: application.clusterId ?? undefined,
      title: entry.title,
      company: application.vacancy?.company ?? '',
      url: application.vacancy?.url,
    },
    entry.state,
  );
}

function SavedList({
  collections,
  entries,
  renderCard,
}: {
  readonly collections: VacancyCollectionsState;
  readonly entries: readonly SavedVacancyEntry[];
  readonly renderCard?: SavedCardRenderer;
}) {
  const [expandedId, setExpandedId] = useState<string>();
  const byId = new Map(collections.savedApplications.map((item) => [item.id, item]));
  return (
    <ul className="saved-list">
      {entries.map((entry) => {
        const application = byId.get(entry.id);
        const item = application && renderCard ? savedItemFor(entry, application) : undefined;
        if (item && renderCard && expandedId === entry.id)
          return (
            <Fragment key={entry.id}>{renderCard(item, () => setExpandedId(undefined))}</Fragment>
          );
        return application ? (
          <SavedRow
            key={entry.id}
            entry={entry}
            application={application}
            busy={collections.savedBusyIds.has(application.clusterId ?? application.id)}
            onRemove={(value) => void collections.removeSaved(value)}
            want={savedWant(collections, application.vacancy?.company)}
            expanded={!item && expandedId === entry.id}
            onExpand={() => setExpandedId((open) => (open === entry.id ? undefined : entry.id))}
          />
        ) : null;
      })}
    </ul>
  );
}

function SavedFooter(props: {
  readonly shown: number;
  readonly total: number;
  readonly hasMore: boolean;
  readonly onMore: () => void;
}) {
  return (
    <footer className="saved-footer">
      <p>
        Показано {props.shown} из {props.total}
      </p>
      {props.hasMore ? (
        <button type="button" className="companies-people-load-more" onClick={props.onMore}>
          Показать ещё 20
        </button>
      ) : null}
    </footer>
  );
}

function SavedIntro() {
  return (
    <p className="saved-intro">
      <Info aria-hidden="true" />
      <span>
        Сохранённые вакансии: ваша короткая подборка для разбора. Ничего не отправляется и не
        теряется при смене фильтров. Вакансия остаётся здесь, пока вы её не уберёте или она не
        закроется на площадке.
      </span>
    </p>
  );
}

export function SavedVacanciesPanel({
  collections,
  onOpenSelection,
  renderCard,
}: {
  readonly collections: VacancyCollectionsState;
  readonly onOpenSelection: () => void;
  readonly renderCard?: SavedCardRenderer;
}) {
  const saved = collections.savedApplications;
  const panel = useSavedPanelState(saved);
  const empty = !collections.savedLoading && !collections.savedError && !saved.length;
  const shown = panel.visible.slice(0, panel.limit);
  return (
    <section className="vacancies-saved-panel" aria-label="Сохранённые вакансии">
      <SavedIntro />
      <SavedStatus collections={collections} statesFailed={panel.statesFailed} />
      {empty ? <SavedEmpty onOpenSelection={onOpenSelection} /> : null}
      {saved.length > 0 ? (
        <>
          <SavedControls
            count={saved.length}
            query={panel.query}
            view={panel.view}
            onQuery={panel.changeQuery}
            onView={panel.changeView}
          />
          {!panel.visible.length ? <p>По этим условиям сохранённых вакансий нет.</p> : null}
          <SavedList collections={collections} entries={shown} renderCard={renderCard} />
          <SavedFooter
            shown={shown.length}
            total={saved.length}
            hasMore={panel.visible.length > panel.limit}
            onMore={panel.showMore}
          />
        </>
      ) : null}
    </section>
  );
}
