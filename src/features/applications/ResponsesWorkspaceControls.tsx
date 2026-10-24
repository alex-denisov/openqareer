import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { CaretDown, Kanban, MagnifyingGlass, Rows, SlidersHorizontal } from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import { getCandidateCompanyPage } from '../vacancies/candidateCompaniesApi';
import { humanSourceLabel } from './sourceLabels';
import type { ResponsesSortMode } from './responsesFiltering';

export type ResponsesWorkspaceSection = 'funnel' | 'company-wants' | 'preparation' | 'offers';
export type ResponsesViewMode = 'columns' | 'table';

export interface ResponsesSummaryFilter {
  readonly stage: readonly ApplicationStage[];
  readonly actionOnly?: boolean;
}

export function ResponsesWorkspaceNavigation({
  section,
  onChange,
  counts,
}: {
  readonly section: ResponsesWorkspaceSection;
  readonly onChange: (section: ResponsesWorkspaceSection) => void;
  readonly counts?: Record<ApplicationStage, number>;
}) {
  const companyWantCount = useCompanyWantCount();
  const tabs = buildWorkspaceTabs(counts, companyWantCount);
  return (
    <nav className="career-responses-workspace-nav" aria-label="Разделы откликов">
      <div className="career-responses-workspace-tabs" role="tablist" aria-label="Отклики">
        {tabs.map((tab, index) => (
          <WorkspaceTabButton
            key={tab.key}
            tab={tab}
            tabs={tabs}
            index={index}
            active={section === tab.key}
            onChange={onChange}
          />
        ))}
      </div>
    </nav>
  );
}

interface WorkspaceTab {
  readonly key: ResponsesWorkspaceSection;
  readonly label: string;
  readonly mobileLabel: string;
  readonly count?: number | null;
}

function buildWorkspaceTabs(
  counts: Record<ApplicationStage, number> | undefined,
  companyWantCount: number | undefined,
): readonly WorkspaceTab[] {
  const totalCount = counts
    ? Object.values(counts).reduce((total, count) => total + count, 0)
    : null;
  return [
    { key: 'funnel', label: 'Воронка', mobileLabel: 'Воронка', count: totalCount },
    {
      key: 'company-wants',
      label: 'Хочу в компанию',
      mobileLabel: 'Хочу',
      count: companyWantCount,
    },
    { key: 'preparation', label: 'Подготовка', mobileLabel: 'Подготовка' },
    { key: 'offers', label: 'Офферы', mobileLabel: 'Офферы', count: counts?.offer ?? null },
  ];
}

function WorkspaceTabButton({
  tab,
  tabs,
  index,
  active,
  onChange,
}: {
  readonly tab: WorkspaceTab;
  readonly tabs: readonly WorkspaceTab[];
  readonly index: number;
  readonly active: boolean;
  readonly onChange: (section: ResponsesWorkspaceSection) => void;
}) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onChange(nextTab.key);
    document.getElementById('career-responses-tab-' + nextTab.key)?.focus();
  }

  return (
    <button
      id={'career-responses-tab-' + tab.key}
      type="button"
      role="tab"
      aria-label={tab.label}
      aria-selected={active}
      aria-controls={'career-responses-tab-panel-' + tab.key}
      tabIndex={active ? 0 : -1}
      className={active ? 'is-active' : ''}
      onKeyDown={handleKeyDown}
      onClick={() => onChange(tab.key)}
    >
      <span className="career-responses-tab-label-desktop">{tab.label}</span>
      <span className="career-responses-tab-label-mobile">{tab.mobileLabel}</span>
      {tab.count !== null && tab.count !== undefined ? (
        <span className="career-responses-tab-count" aria-hidden="true">
          {tab.count.toLocaleString('ru-RU')}
        </span>
      ) : null}
    </button>
  );
}

function useCompanyWantCount(): number | undefined {
  const [count, setCount] = useState<number>();
  useEffect(() => {
    let active = true;
    void getCandidateCompanyPage({ filter: 'want', offset: 0 })
      .then((page) => {
        if (active) setCount(page.filterCounts.want ?? page.total);
      })
      .catch(() => {
        if (active) setCount(undefined);
      });
    return () => {
      active = false;
    };
  }, []);
  return count;
}

interface SummaryItem {
  readonly label: string;
  readonly count: number | string;
  readonly filter: ResponsesSummaryFilter;
}

export function ResponsesFunnelSummary({
  active,
  counts,
  needsActionCount,
  actionCountLoading,
  onFilter,
}: {
  readonly counts?: Record<ApplicationStage, number>;
  readonly needsActionCount: number;
  readonly actionCountLoading: boolean;
  readonly onFilter: (filter: ResponsesSummaryFilter) => void;
  /** The filter on screen: its chip is drawn pressed (mockup 5 `.stat[aria-pressed]`). */
  readonly active?: ResponsesSummaryFilter;
}) {
  const items = buildSummaryItems(counts, needsActionCount, actionCountLoading);
  return (
    <section className="career-responses-funnel-summary" aria-label="Сводка этапов">
      {items.map((item) => (
        <SummaryButton
          key={item.label}
          item={item}
          pressed={sameSummaryFilter(item.filter, active)}
          busy={item.label === 'нужно действие' && actionCountLoading}
          onFilter={onFilter}
        />
      ))}
    </section>
  );
}

function buildSummaryItems(
  counts: Record<ApplicationStage, number> | undefined,
  needsActionCount: number,
  actionCountLoading: boolean,
): readonly SummaryItem[] {
  const count = (stage: ApplicationStage) => counts?.[stage] ?? 0;
  const total = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0;
  return [
    { label: 'все', count: total.toLocaleString('ru-RU'), filter: { stage: [] } },
    {
      label: 'нужно действие',
      count: actionCountLoading ? '—' : needsActionCount.toLocaleString('ru-RU'),
      filter: { stage: [], actionOnly: true },
    },
    {
      label: 'ждут ответа',
      count: count('applied').toLocaleString('ru-RU'),
      filter: { stage: ['applied'] },
    },
    {
      label: 'ответили',
      count: count('responded').toLocaleString('ru-RU'),
      filter: { stage: ['responded'] },
    },
    {
      label: 'интервью',
      count: count('interview').toLocaleString('ru-RU'),
      filter: { stage: ['interview'] },
    },
    { label: 'оффер', count: count('offer').toLocaleString('ru-RU'), filter: { stage: ['offer'] } },
    {
      label: 'закрыто',
      count: (count('rejected') + count('archived')).toLocaleString('ru-RU'),
      filter: { stage: ['rejected', 'archived'] },
    },
  ];
}

function sameSummaryFilter(item: ResponsesSummaryFilter, active?: ResponsesSummaryFilter): boolean {
  if (!active) return false;
  if (Boolean(item.actionOnly) !== Boolean(active.actionOnly)) return false;
  return [...item.stage].sort().join() === [...active.stage].sort().join();
}

function SummaryButton({
  item,
  busy,
  pressed,
  onFilter,
}: {
  readonly item: SummaryItem;
  readonly busy: boolean;
  readonly pressed: boolean;
  readonly onFilter: (filter: ResponsesSummaryFilter) => void;
}) {
  return (
    <button
      type="button"
      className={item.filter.actionOnly ? 'is-hot' : undefined}
      aria-label={`${item.count} ${item.label}`}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      onClick={() => onFilter(item.filter)}
    >
      <strong>{item.count}</strong>
      <span>{item.label}</span>
    </button>
  );
}

export function ResponsesViewSwitch({
  view,
  onChange,
}: {
  readonly view: ResponsesViewMode;
  readonly onChange: (view: ResponsesViewMode) => void;
}) {
  return (
    <div className="career-responses-view-switch" role="group" aria-label="Вид откликов">
      <button type="button" aria-pressed={view === 'columns'} onClick={() => onChange('columns')}>
        <Kanban size={16} aria-hidden="true" />
        Колонки
      </button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => onChange('table')}>
        <Rows size={16} aria-hidden="true" />
        Таблица
      </button>
    </div>
  );
}

interface ResponsesFilterControlsProps {
  readonly applications: readonly ApplicationView[];
  readonly query: ApplicationListQuery;
  readonly search: string;
  readonly sortMode: ResponsesSortMode;
  readonly period: ResponsesPeriod;
  readonly onSearchChange: (value: string) => void;
  readonly onQueryChange: (query: ApplicationListQuery) => void;
  readonly onSortChange: (mode: ResponsesSortMode) => void;
  readonly onPeriodChange: (period: ResponsesPeriod) => void;
  readonly view: ResponsesViewMode;
  readonly onViewChange: (view: ResponsesViewMode) => void;
}

export function ResponsesFilterControls(props: ResponsesFilterControlsProps) {
  const channels = availableChannels(props.applications);
  return (
    <div className="career-responses-toolbar">
      <div className="career-responses-filterbar" aria-label="Фильтры откликов">
        <SearchFilter value={props.search} onChange={props.onSearchChange} />
        <SelectWrap>
          <ChannelFilter query={props.query} channels={channels} onChange={props.onQueryChange} />
        </SelectWrap>
        <SelectWrap>
          <PeriodFilter value={props.period} onChange={props.onPeriodChange} />
        </SelectWrap>
        <SelectWrap>
          <SortFilter value={props.sortMode} onChange={props.onSortChange} />
        </SelectWrap>
        <MobileFilterDialog props={props} channels={channels} />
      </div>
      <ResponsesViewSwitch view={props.view} onChange={props.onViewChange} />
    </div>
  );
}

/** Mockup 5 `.career-select-wrap`: one select look with a Phosphor caret. */
function SelectWrap({ children }: { readonly children: ReactNode }) {
  return (
    <span className="career-responses-filter-select">
      {children}
      <CaretDown size={16} aria-hidden="true" />
    </span>
  );
}

interface MobileFilterDraft {
  readonly channel: string;
  readonly period: ResponsesPeriod;
  readonly sortMode: ResponsesSortMode;
}

function createMobileFilterDraft(props: ResponsesFilterControlsProps): MobileFilterDraft {
  return {
    channel: props.query.channel?.[0] ?? '',
    period: props.period,
    sortMode: props.sortMode,
  };
}

function trapDialogTab(
  event: ReactKeyboardEvent<HTMLDialogElement>,
  dialog: HTMLDialogElement | null,
) {
  if (event.key !== 'Tab' || !dialog) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusable.length === 0) return;
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
  if (activeIndex < 0 || (event.shiftKey && activeIndex === 0)) {
    event.preventDefault();
    focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
  } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
    event.preventDefault();
    focusable[0]?.focus();
  }
}

function useMobileFilterDialog(props: ResponsesFilterControlsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(() => createMobileFilterDraft(props));
  const open = () => {
    setDraft(createMobileFilterDraft(props));
    dialogRef.current?.showModal();
    setIsOpen(true);
  };
  const close = () => dialogRef.current?.close();
  const handleClose = () => {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const handleTabTrap = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    trapDialogTab(event, dialogRef.current);
  };
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onQueryChange({ channel: draft.channel ? [draft.channel] : [], offset: 0 });
    props.onPeriodChange(draft.period);
    props.onSortChange(draft.sortMode);
    close();
  };
  return {
    triggerRef,
    dialogRef,
    isOpen,
    draft,
    setDraft,
    open,
    close,
    handleClose,
    handleTabTrap,
    apply,
  };
}

function MobileFilterDialog({
  props,
  channels,
}: {
  readonly props: ResponsesFilterControlsProps;
  readonly channels: readonly string[];
}) {
  const state = useMobileFilterDialog(props);
  return (
    <>
      <button
        ref={state.triggerRef}
        type="button"
        className="career-responses-filters-trigger"
        aria-haspopup="dialog"
        aria-expanded={state.isOpen}
        aria-controls="career-responses-filter-dialog"
        onClick={state.open}
      >
        <SlidersHorizontal aria-hidden="true" />
        <span>Фильтры</span>
      </button>
      <dialog
        ref={state.dialogRef}
        id="career-responses-filter-dialog"
        className="career-responses-filter-dialog"
        aria-labelledby="career-responses-filter-title"
        aria-modal="true"
        onClose={state.handleClose}
        onKeyDown={state.handleTabTrap}
      >
        <form onSubmit={state.apply}>
          <h2 id="career-responses-filter-title">Фильтры</h2>
          <MobileFilterFields draft={state.draft} setDraft={state.setDraft} channels={channels} />
          <MobileFilterActions onCancel={state.close} />
        </form>
      </dialog>
    </>
  );
}

function MobileFilterFields({
  draft,
  setDraft,
  channels,
}: {
  readonly draft: MobileFilterDraft;
  readonly setDraft: Dispatch<SetStateAction<MobileFilterDraft>>;
  readonly channels: readonly string[];
}) {
  return (
    <div className="career-responses-filter-fields">
      <div className="career-responses-filter-field">
        <label htmlFor="career-responses-filter-channel">Канал</label>
        <ChannelFilter
          id="career-responses-filter-channel"
          query={{ channel: draft.channel ? [draft.channel] : [] }}
          channels={channels}
          onChange={(query) =>
            setDraft((current) => ({ ...current, channel: query.channel?.[0] ?? '' }))
          }
        />
      </div>
      <div className="career-responses-filter-field">
        <label htmlFor="career-responses-filter-period">Период</label>
        <PeriodFilter
          id="career-responses-filter-period"
          value={draft.period}
          onChange={(period) => setDraft((current) => ({ ...current, period }))}
        />
      </div>
      <div className="career-responses-filter-field">
        <label htmlFor="career-responses-filter-sort">Сортировка</label>
        <SortFilter
          id="career-responses-filter-sort"
          value={draft.sortMode}
          onChange={(sortMode) => setDraft((current) => ({ ...current, sortMode }))}
        />
      </div>
    </div>
  );
}

function MobileFilterActions({ onCancel }: { readonly onCancel: () => void }) {
  return (
    <footer className="career-responses-filter-actions">
      <button type="button" className="career-btn career-btn-secondary" onClick={onCancel}>
        Отмена
      </button>
      <button type="submit" className="career-btn career-btn-primary">
        Применить
      </button>
    </footer>
  );
}

function SearchFilter({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="career-responses-search">
      <MagnifyingGlass aria-hidden="true" />
      <input
        className="career-responses-search-desktop"
        type="search"
        aria-label="Компания, роль или площадка"
        placeholder="Компания, роль или площадка"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <input
        className="career-responses-search-mobile"
        type="search"
        aria-label="Компания или роль"
        placeholder="Компания или роль"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function ChannelFilter({
  id,
  query,
  channels,
  onChange,
}: {
  readonly id?: string;
  readonly query: ApplicationListQuery;
  readonly channels: readonly string[];
  readonly onChange: (query: ApplicationListQuery) => void;
}) {
  return (
    <select
      id={id}
      aria-label={id ? undefined : 'Канал отклика'}
      value={query.channel?.[0] ?? ''}
      onChange={(event) =>
        onChange({
          channel: event.currentTarget.value ? [event.currentTarget.value] : [],
          offset: 0,
        })
      }
    >
      <option value="">Все каналы</option>
      {channels.map((channel) => (
        <option key={channel} value={channel}>
          {humanSourceLabel(channel)}
        </option>
      ))}
    </select>
  );
}

function PeriodFilter({
  id,
  value,
  onChange,
}: {
  readonly id?: string;
  readonly value: ResponsesPeriod;
  readonly onChange: (period: ResponsesPeriod) => void;
}) {
  return (
    <select
      id={id}
      aria-label={id ? undefined : 'Период откликов'}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value as ResponsesPeriod)}
    >
      <option value="30">Последние 30 дней</option>
      <option value="7">Последние 7 дней</option>
      <option value="90">Последние 90 дней</option>
      <option value="all">Всё время</option>
    </select>
  );
}

function SortFilter({
  id,
  value,
  onChange,
}: {
  readonly id?: string;
  readonly value: ResponsesSortMode;
  readonly onChange: (mode: ResponsesSortMode) => void;
}) {
  return (
    <select
      id={id}
      aria-label={id ? undefined : 'Сортировка откликов'}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value as ResponsesSortMode)}
    >
      <option value="step">По сроку шага</option>
      <option value="newest">Сначала новые</option>
      <option value="oldest">Сначала старые</option>
    </select>
  );
}

export type ResponsesPeriod = '7' | '30' | '90' | 'all';

function availableChannels(applications: readonly ApplicationView[]): string[] {
  return Array.from(
    new Set(
      applications
        .map((application) => application.vacancy?.source)
        .filter((source): source is string => Boolean(source)),
    ),
  ).sort((left, right) => humanSourceLabel(left).localeCompare(humanSourceLabel(right), 'ru'));
}
