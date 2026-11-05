import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { CaretDown, Kanban, MagnifyingGlass, Rows } from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import { getCandidateCompanyPage } from '../vacancies/candidateCompaniesApi';
import { humanSourceLabel } from './sourceLabels';
import { ResponsesFilterSheet, type FilterStageItem } from './ResponsesFilterSheet';
import type { ResponsesPeriod } from './responsesFilterDraft';
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
  /** «Этап» in the 390 filter sheet reuses the funnel summary filters. */
  readonly stageCounts?: Record<ApplicationStage, number>;
  readonly needsActionCount?: number;
  readonly actionOnly?: boolean;
  readonly onSummaryFilter?: (filter: ResponsesSummaryFilter) => void;
  /** Every row of the applied period is loaded: «Показать N» can count them. */
  readonly loadedAll?: boolean;
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
        <ResponsesFilterSheet
          applications={props.applications}
          channels={channels}
          query={props.query}
          search={props.search}
          sortMode={props.sortMode}
          period={props.period}
          loadedAll={props.loadedAll ?? false}
          stageItems={filterStageItems(props)}
          currentStage={currentStageKey(props)}
          onQueryChange={props.onQueryChange}
          onSortChange={props.onSortChange}
          onPeriodChange={props.onPeriodChange}
        />
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

function filterStageItems(props: ResponsesFilterControlsProps): readonly FilterStageItem[] {
  const { onSummaryFilter } = props;
  if (!onSummaryFilter) return [];
  return mobileStageItems(props).map((item) => ({
    key: item.label,
    count: String(item.count),
    apply: () => onSummaryFilter(item.filter),
  }));
}

function mobileStageItems(props: ResponsesFilterControlsProps): readonly SummaryItem[] {
  return buildSummaryItems(props.stageCounts, props.needsActionCount ?? 0, false);
}

function currentStageKey(props: ResponsesFilterControlsProps): string {
  if (props.actionOnly) return 'нужно действие';
  const stages = JSON.stringify([...(props.query.stage ?? [])].sort());
  const match = mobileStageItems(props).find(
    (item) => !item.filter.actionOnly && JSON.stringify([...item.filter.stage].sort()) === stages,
  );
  return match?.label ?? 'все';
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

export type { ResponsesPeriod };

function availableChannels(applications: readonly ApplicationView[]): string[] {
  return Array.from(
    new Set(
      applications
        .map((application) => application.vacancy?.source)
        .filter((source): source is string => Boolean(source)),
    ),
  ).sort((left, right) => humanSourceLabel(left).localeCompare(humanSourceLabel(right), 'ru'));
}
