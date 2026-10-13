import { useEffect, useState } from 'react';
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
        {tabs.map((tab) => (
          <WorkspaceTabButton
            key={tab.key}
            tab={tab}
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
  active,
  onChange,
}: {
  readonly tab: WorkspaceTab;
  readonly active: boolean;
  readonly onChange: (section: ResponsesWorkspaceSection) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-label={tab.label}
      aria-selected={active}
      className={active ? 'is-active' : ''}
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
  counts,
  needsActionCount,
  actionCountLoading,
  onFilter,
}: {
  readonly counts?: Record<ApplicationStage, number>;
  readonly needsActionCount: number;
  readonly actionCountLoading: boolean;
  readonly onFilter: (filter: ResponsesSummaryFilter) => void;
}) {
  const items = buildSummaryItems(counts, needsActionCount, actionCountLoading);
  return (
    <section className="career-responses-funnel-summary" aria-label="Сводка этапов">
      {items.map((item) => (
        <SummaryButton
          key={item.label}
          item={item}
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

function SummaryButton({
  item,
  busy,
  onFilter,
}: {
  readonly item: SummaryItem;
  readonly busy: boolean;
  readonly onFilter: (filter: ResponsesSummaryFilter) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${item.count} ${item.label}`}
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
        Колонки
      </button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => onChange('table')}>
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
        <ChannelFilter query={props.query} channels={channels} onChange={props.onQueryChange} />
        <PeriodFilter value={props.period} onChange={props.onPeriodChange} />
        <SortFilter value={props.sortMode} onChange={props.onSortChange} />
      </div>
      <ResponsesViewSwitch view={props.view} onChange={props.onViewChange} />
    </div>
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
    <input
      type="search"
      aria-label="Компания, роль или площадка"
      placeholder="Компания, роль или площадка"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function ChannelFilter({
  query,
  channels,
  onChange,
}: {
  readonly query: ApplicationListQuery;
  readonly channels: readonly string[];
  readonly onChange: (query: ApplicationListQuery) => void;
}) {
  return (
    <select
      aria-label="Канал отклика"
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
  value,
  onChange,
}: {
  readonly value: ResponsesPeriod;
  readonly onChange: (period: ResponsesPeriod) => void;
}) {
  return (
    <select
      aria-label="Период откликов"
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
  value,
  onChange,
}: {
  readonly value: ResponsesSortMode;
  readonly onChange: (mode: ResponsesSortMode) => void;
}) {
  return (
    <select
      aria-label="Сортировка откликов"
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
