import { Download } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { CandidateAutomationJournalEntry } from '../../../server/candidate/sqliteCandidateAutomationRepository';
import type { AutomationJournalPage } from './automationApi';
import { automationDateLabel, automationJournalStatusLabel, automationPlatformLabel } from './automationFormat';

export interface AutomationJournalPanelProps {
  readonly page: AutomationJournalPage | null;
  readonly loading: boolean;
  readonly error: string;
  readonly exportBusy: boolean;
  readonly onFiltersChange: (options: { periodDays: number; result?: 'delivered' | 'error' | 'removed'; platform?: 'hh' | 'linkedin' }) => void;
  readonly onExport: () => void;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
}

type JournalResultFilter = '' | 'delivered' | 'error' | 'removed';
type JournalPlatformFilter = '' | 'hh' | 'linkedin';

export function AutomationJournalPanel(props: AutomationJournalPanelProps) {
  const [periodDays, setPeriodDays] = useState(30);
  const [result, setResult] = useState<JournalResultFilter>('');
  const [platform, setPlatform] = useState<JournalPlatformFilter>('');
  const [search, setSearch] = useState('');
  const entries = useMemo(() => filterJournalSearch(props.page?.entries ?? [], search), [props.page?.entries, search]);
  const onFilter = (patch: { periodDays?: number; result?: JournalResultFilter; platform?: JournalPlatformFilter }) => applyFilters(patch, { periodDays, result, platform, setPeriodDays, setResult, setPlatform, notify: props.onFiltersChange });

  return <section className="automation-panel automation-journal-panel" data-page="journal" aria-labelledby="automation-journal-title">
    <JournalHeader page={props.page} />
    <JournalFilters periodDays={periodDays} result={result} platform={platform} search={search} onSearch={setSearch} onChange={onFilter} />
    {props.page ? <JournalCounts page={props.page} /> : null}
    {props.error ? <JournalError error={props.error} onRetry={props.onRetry} /> : null}
    {props.loading ? <p className="automation-loading" role="status" aria-busy="true">Загружаем журнал…</p> : null}
    {!props.loading && !props.error && entries.length === 0 ? <p className="automation-empty" role="status">Попыток отправки за {props.page?.periodDays ?? periodDays} дней пока нет.</p> : null}
    {entries.length ? <JournalRows entries={entries} /> : null}
    {props.page && props.page.entries.length < props.page.counts.total ? <button className="career-btn career-btn-secondary automation-load-more" type="button" disabled={props.loading} onClick={props.onLoadMore}>Показать ещё</button> : null}
    <button className="career-btn career-btn-secondary automation-export" type="button" disabled={props.exportBusy} onClick={props.onExport}><Download size={18} aria-hidden="true" />{props.exportBusy ? 'Готовим экспорт…' : 'Экспорт журнала за 30 дней'}</button>
  </section>;
}

function JournalHeader({ page }: { readonly page: AutomationJournalPage | null }) {
  return <header className="automation-panel-heading"><div><h2 id="automation-journal-title">Журнал автооткликов</h2><p>Результаты за выбранный период; отправка считается доставленной только с квитанцией.</p></div><span className="automation-count">{page?.counts.total ?? '—'}</span></header>;
}

function JournalFilters({ periodDays, result, platform, search, onSearch, onChange }: {
  readonly periodDays: number;
  readonly result: JournalResultFilter;
  readonly platform: JournalPlatformFilter;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly onChange: (patch: { periodDays?: number; result?: JournalResultFilter; platform?: JournalPlatformFilter }) => void;
}) {
  return <div className="automation-filter-grid">
    <label>Период<select value={periodDays} onChange={(event) => onChange({ periodDays: Number(event.currentTarget.value) })}><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option></select></label>
    <label>Результат<select value={result} onChange={(event) => onChange({ result: event.currentTarget.value as JournalResultFilter })}><option value="">Все</option><option value="delivered">Доставлено</option><option value="error">Ошибки</option><option value="removed">Снято</option></select></label>
    <label>Площадка<select value={platform} onChange={(event) => onChange({ platform: event.currentTarget.value as JournalPlatformFilter })}><option value="">Все площадки</option><option value="hh">hh.ru</option><option value="linkedin">LinkedIn</option></select></label>
    <label>Компания или квитанция<input type="search" value={search} onChange={(event) => onSearch(event.currentTarget.value)} /></label>
  </div>;
}

function JournalCounts({ page }: { readonly page: AutomationJournalPage }) {
  return <div className="automation-journal-counts" aria-label={`Сводка за ${page.periodDays} дней`}>
    <span>Доставлено <b>{page.counts.delivered}</b></span><span>Ошибки <b>{page.counts.errors}</b></span><span>Снято <b>{page.counts.removed}</b></span>
  </div>;
}

function JournalError({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }) {
  return <div className="automation-error-row" role="alert"><span>{error}</span><button className="career-btn career-btn-secondary" type="button" onClick={onRetry}>Повторить</button></div>;
}

function JournalRows({ entries }: { readonly entries: readonly CandidateAutomationJournalEntry[] }) {
  return <ul className="automation-journal-list" aria-label="Результаты отправки">
    {entries.map((entry) => <li key={entry.id} className="automation-journal-row">
      <div><strong>{entry.company}</strong><small>{automationDateLabel(entry.occurredAt)} · {automationPlatformLabel(entry.platform)}</small></div>
      <span className={`automation-result is-${entry.result}`}>{automationJournalStatusLabel(entry)}</span>
      {entry.receiptId ? <small>Квитанция {entry.receiptId}</small> : null}
      {entry.failureCode ? <small>Код: {entry.failureCode}</small> : null}
    </li>)}
  </ul>;
}

function applyFilters(patch: { periodDays?: number; result?: JournalResultFilter; platform?: JournalPlatformFilter }, current: {
  readonly periodDays: number;
  readonly result: JournalResultFilter;
  readonly platform: JournalPlatformFilter;
  readonly setPeriodDays: (value: number) => void;
  readonly setResult: (value: JournalResultFilter) => void;
  readonly setPlatform: (value: JournalPlatformFilter) => void;
  readonly notify: AutomationJournalPanelProps['onFiltersChange'];
}) {
  const periodDays = patch.periodDays ?? current.periodDays;
  const result = patch.result ?? current.result;
  const platform = patch.platform ?? current.platform;
  current.setPeriodDays(periodDays);
  current.setResult(result);
  current.setPlatform(platform);
  current.notify({ periodDays, ...(result ? { result } : {}), ...(platform ? { platform } : {}) });
}

function filterJournalSearch(entries: readonly CandidateAutomationJournalEntry[], search: string) {
  const needle = search.trim().toLocaleLowerCase('ru');
  return entries.filter((entry) => !needle || `${entry.company} ${entry.receiptId ?? ''} ${entry.failureCode ?? ''}`.toLocaleLowerCase('ru').includes(needle));
}
