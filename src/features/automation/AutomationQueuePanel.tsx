import { Check, EnvelopeSimple, Prohibit, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { AutomationQueueAction, AutomationQueueItem } from './automationApi';
import { AutomationQueueTable } from './AutomationQueueTable';
import { automationDateLabel, automationPlatformLabel, automationQueueStatusLabel } from './automationFormat';

export interface AutomationQueuePanelProps {
  readonly items: readonly AutomationQueueItem[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: string;
  readonly enabled: boolean;
  readonly canApprove: boolean;
  readonly notice: string;
  readonly refreshing: boolean;
  readonly onAction: (item: AutomationQueueItem, action: AutomationQueueAction) => Promise<void>;
  readonly onBulkAction: (items: readonly AutomationQueueItem[], action: AutomationQueueAction) => Promise<void>;
  readonly onRefresh: () => void;
  readonly onEdit: (item: AutomationQueueItem) => void;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
}

type QueueStatusFilter = '' | 'letter_not_ready' | 'pending_approval' | 'approved' | 'failed';
type QueuePlatformFilter = '' | 'hh' | 'linkedin';
type QueueSort = 'send' | 'match';
type QueueTimingFilter = '' | 'today' | 'later';

export function AutomationQueuePanel(props: AutomationQueuePanelProps) {
  const [status, setStatus] = useState<QueueStatusFilter>('pending_approval');
  const [platform, setPlatform] = useState<QueuePlatformFilter>('');
  const [minimumMatch, setMinimumMatch] = useState('0');
  const [sort, setSort] = useState<QueueSort>('send');
  const [timing, setTiming] = useState<QueueTimingFilter>('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [busyId, setBusyId] = useState('');
  const visible = useMemo(() => filterAndSort(props.items, status, platform, minimumMatch, sort, timing), [props.items, status, platform, minimumMatch, sort, timing]);
  const allSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));

  function updateFilter(update: () => void) {
    update();
    setSelected(new Set());
  }

  function toggleItem(id: string) {
    setSelected((current) => toggleSelection(current, id));
  }

  async function applyAction(item: AutomationQueueItem, action: AutomationQueueAction) {
    setBusyId(item.id);
    try { await props.onAction(item, action); }
    finally { setBusyId(''); }
  }

  async function applyBulk(action: AutomationQueueAction) {
    const chosen = visible.filter((item) => selected.has(item.id));
    if (!chosen.length) return;
    await props.onBulkAction(chosen, action);
    setSelected(new Set());
  }

  return <section className="automation-panel automation-queue-panel" data-page="queue" aria-labelledby="automation-queue-title">
    <QueueHeader total={props.total} enabled={props.enabled} refreshing={props.refreshing} onRefresh={props.onRefresh} />
    <QueueSummaryChips items={props.items} total={props.total} status={status} timing={timing} onSelect={(nextStatus, nextTiming) => updateFilter(() => { setStatus(nextStatus); setTiming(nextTiming); })} />
    <QueueFilters status={status} platform={platform} minimumMatch={minimumMatch} sort={sort} onStatus={(value) => updateFilter(() => setStatus(value))} onPlatform={(value) => updateFilter(() => setPlatform(value))} onMinimumMatch={(value) => updateFilter(() => setMinimumMatch(value))} onSort={setSort} />
    {props.notice ? <p className="automation-status" role="status">{props.notice}</p> : null}
    {!props.enabled ? <p className="automation-info-note">Чтобы обновить очередь, сначала включите автоотклики и сохраните согласия.</p> : null}
    {props.error ? <QueueError error={props.error} onRetry={props.onRetry} /> : null}
    {props.loading ? <p className="automation-loading" role="status" aria-busy="true">Загружаем очередь…</p> : null}
    {!props.loading && !props.error && visible.length === 0 ? <p className="automation-empty" role="status">Записей по этим фильтрам пока нет.</p> : null}
    {visible.length ? <QueueRecords items={visible} selected={selected} allSelected={allSelected} busyId={busyId} enabled={props.enabled} canApprove={props.canApprove} onToggleItem={toggleItem} onToggleAll={() => setSelected(toggleAllSelection(selected, visible, allSelected))} onAction={applyAction} onEdit={props.onEdit} onBulk={applyBulk} /> : null}
    {props.items.length < props.total ? <button className="career-btn career-btn-secondary automation-load-more" type="button" disabled={props.loading} onClick={props.onLoadMore}>Показать ещё</button> : null}
  </section>;
}

function QueueHeader({ total, enabled, refreshing, onRefresh }: { readonly total: number; readonly enabled: boolean; readonly refreshing: boolean; readonly onRefresh: () => void }) {
  return <header className="automation-panel-heading">
    <div><h2 id="automation-queue-title">Очередь на одобрение</h2><p>Одобрение ставит отклик в расписание. Доставка появится только после квитанции площадки.</p></div>
    <span className="automation-count">{total}</span>
    <button className="career-btn career-btn-secondary" type="button" disabled={!enabled || refreshing} onClick={onRefresh}>{refreshing ? 'Обновляем…' : 'Обновить очередь'}</button>
  </header>;
}

function QueueFilters({ status, platform, minimumMatch, sort, onStatus, onPlatform, onMinimumMatch, onSort }: {
  readonly status: QueueStatusFilter;
  readonly platform: QueuePlatformFilter;
  readonly minimumMatch: string;
  readonly sort: QueueSort;
  readonly onStatus: (value: QueueStatusFilter) => void;
  readonly onPlatform: (value: QueuePlatformFilter) => void;
  readonly onMinimumMatch: (value: string) => void;
  readonly onSort: (value: QueueSort) => void;
}) {
  return <div className="automation-filter-grid">
    <label>Состояние<select value={status} onChange={(event) => onStatus(event.currentTarget.value as QueueStatusFilter)}><option value="">Все</option><option value="pending_approval">Ждут одобрения</option><option value="letter_not_ready">Письмо не готово</option><option value="approved">Одобрены, ожидают отправки</option><option value="failed">Ошибки</option></select></label>
    <label>Площадка<select value={platform} onChange={(event) => onPlatform(event.currentTarget.value as QueuePlatformFilter)}><option value="">Все площадки</option><option value="hh">hh.ru</option><option value="linkedin">LinkedIn</option></select></label>
    <label>Совпадение<select value={minimumMatch} onChange={(event) => onMinimumMatch(event.currentTarget.value)}><option value="0">Любое</option><option value="60">От 60 %</option><option value="80">От 80 %</option><option value="90">От 90 %</option></select></label>
    <label>Сортировка<select value={sort} onChange={(event) => onSort(event.currentTarget.value as QueueSort)}><option value="send">По времени</option><option value="match">По совпадению</option></select></label>
  </div>;
}

interface QueueChip {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly status: QueueStatusFilter;
  readonly timing: QueueTimingFilter;
}

function queueChips(items: readonly AutomationQueueItem[], total: number): QueueChip[] {
  const count = (test: (item: AutomationQueueItem) => boolean) => items.filter(test).length;
  return [
    { key: 'all', label: 'все', count: total, status: '', timing: '' },
    { key: 'today', label: 'уйдёт сегодня', count: count((item) => item.status === 'pending_approval' && item.sendTiming === 'today'), status: 'pending_approval', timing: 'today' },
    { key: 'later', label: 'позже', count: count((item) => item.status === 'pending_approval' && item.sendTiming !== 'today'), status: 'pending_approval', timing: 'later' },
    { key: 'letter', label: 'письмо не готово', count: count((item) => item.status === 'letter_not_ready'), status: 'letter_not_ready', timing: '' },
  ];
}

// Counts other than «все» are taken from the loaded page, so they appear only once the whole queue is loaded.
function QueueSummaryChips({ items, total, status, timing, onSelect }: {
  readonly items: readonly AutomationQueueItem[];
  readonly total: number;
  readonly status: QueueStatusFilter;
  readonly timing: QueueTimingFilter;
  readonly onSelect: (status: QueueStatusFilter, timing: QueueTimingFilter) => void;
}) {
  if (total === 0) return null;
  const complete = items.length >= total;
  const chips = queueChips(items, total).filter((chip) => chip.key === 'all' || (complete && chip.count > 0));
  return <div className="automation-queue-chips" role="group" aria-label="Сводка очереди">
    {chips.map((chip) => <button key={chip.key} type="button" className="automation-queue-chip" aria-pressed={status === chip.status && timing === chip.timing} onClick={() => onSelect(chip.status, chip.timing)}><strong>{chip.count}</strong> {chip.label}</button>)}
  </div>;
}

function QueueError({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }) {
  return <div className="automation-error-row" role="alert"><span>{error}</span><button className="career-btn career-btn-secondary" type="button" onClick={onRetry}>Повторить</button></div>;
}

function QueueRecords({ items, selected, allSelected, busyId, enabled, canApprove, onToggleItem, onToggleAll, onAction, onEdit, onBulk }: {
  readonly items: readonly AutomationQueueItem[];
  readonly selected: ReadonlySet<string>;
  readonly allSelected: boolean;
  readonly busyId: string;
  readonly enabled: boolean;
  readonly canApprove: boolean;
  readonly onToggleItem: (id: string) => void;
  readonly onToggleAll: () => void;
  readonly onAction: (item: AutomationQueueItem, action: AutomationQueueAction) => void;
  readonly onEdit: (item: AutomationQueueItem) => void;
  readonly onBulk: (action: AutomationQueueAction) => void;
}) {
  return <>
    <div className="automation-select-row"><label className="automation-check-label"><input type="checkbox" checked={allSelected} onChange={onToggleAll} />Выбрать показанные ({items.length})</label>
      {selected.size ? <QueueBulkActions count={selected.size} enabled={enabled} canApprove={canApprove} onBulk={onBulk} /> : null}
    </div>
    <AutomationQueueTable items={items} selected={selected} allSelected={allSelected} busyId={busyId} enabled={enabled} canApprove={canApprove} onToggleItem={onToggleItem} onToggleAll={onToggleAll} onAction={onAction} onEdit={onEdit} />
    <ul className="automation-queue-list" aria-label="Записи очереди">{items.map((item) => <QueueItemCard key={item.id} item={item} selected={selected.has(item.id)} busy={busyId === item.id} enabled={enabled} canApprove={canApprove} onToggle={() => onToggleItem(item.id)} onAction={(action) => onAction(item, action)} onEdit={() => onEdit(item)} />)}</ul>
  </>;
}

function QueueBulkActions({ count, enabled, canApprove, onBulk }: { readonly count: number; readonly enabled: boolean; readonly canApprove: boolean; readonly onBulk: (action: AutomationQueueAction) => void }) {
  return <div className="automation-bulk-actions" aria-label="Действия для выбранных"><span>Выбрано {count}</span><button type="button" disabled={!enabled || !canApprove} onClick={() => onBulk('approve_and_send')}>Одобрить</button><button type="button" onClick={() => onBulk('remove')}>Снять</button><button type="button" onClick={() => onBulk('stop_company')}>В стоп-компании</button></div>;
}

function QueueItemCard({ item, selected, busy, enabled, canApprove, onToggle, onAction, onEdit }: {
  readonly item: AutomationQueueItem;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly canApprove: boolean;
  readonly onToggle: () => void;
  readonly onAction: (action: AutomationQueueAction) => void;
  readonly onEdit: () => void;
}) {
  return <li className="automation-queue-card">
    <div className="automation-queue-card-main"><label className="automation-row-check" aria-label={`Выбрать ${item.company}`}><input type="checkbox" checked={selected} onChange={onToggle} /></label><QueueItemSummary item={item} /></div>
    <QueueItemActions item={item} busy={busy} enabled={enabled} canApprove={canApprove} onAction={onAction} onEdit={onEdit} />
  </li>;
}

function QueueItemSummary({ item }: { readonly item: AutomationQueueItem }) {
  return <div className="automation-queue-copy"><h3>{item.company}</h3><p>{item.role || item.title} · {automationPlatformLabel(item.platform)}</p><div className="automation-queue-meta"><span>{automationQueueStatusLabel(item.status)}</span><span>{item.requirements.matched} из {item.requirements.total}</span><span>{item.sendTiming === 'today' ? 'Сегодня' : 'Позже'}</span><span>{automationDateLabel(item.updatedAt)}</span></div></div>;
}

function QueueItemActions({ item, busy, enabled, canApprove, onAction, onEdit }: {
  readonly item: AutomationQueueItem;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly canApprove: boolean;
  readonly onAction: (action: AutomationQueueAction) => void;
  readonly onEdit: () => void;
}) {
  return <div className="automation-row-actions">
    {item.status === 'pending_approval' ? <button type="button" disabled={busy || !enabled || !canApprove} onClick={() => onAction('approve_and_send')}><Check size={18} aria-hidden="true" />Одобрить и отправить</button> : null}
    {isEditable(item.status) ? <button type="button" disabled={busy} onClick={onEdit}><EnvelopeSimple size={18} aria-hidden="true" />Править письмо</button> : null}
    {isOpen(item.status) ? <button type="button" disabled={busy} onClick={() => onAction('remove')}><X size={18} aria-hidden="true" />Снять с очереди</button> : null}
    {isEditable(item.status) ? <button type="button" disabled={busy} onClick={() => onAction('stop_company')}><Prohibit size={18} aria-hidden="true" />В стоп-компании</button> : null}
  </div>;
}

function filterAndSort(items: readonly AutomationQueueItem[], status: QueueStatusFilter, platform: QueuePlatformFilter, minimumMatch: string, sort: QueueSort, timing: QueueTimingFilter): AutomationQueueItem[] {
  const threshold = Number(minimumMatch);
  return items.filter((item) => (!status || item.status === status) && (!platform || item.platform === platform))
    .filter((item) => !timing || (timing === 'today' ? item.sendTiming === 'today' : item.sendTiming !== 'today'))
    .filter((item) => threshold === 0 || (item.requirements.matched / item.requirements.total) * 100 >= threshold)
    .sort((left, right) => sort === 'match'
      ? (right.requirements.matched / right.requirements.total) - (left.requirements.matched / left.requirements.total)
      : left.updatedAt.localeCompare(right.updatedAt));
}

function toggleSelection(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function toggleAllSelection(current: ReadonlySet<string>, items: readonly AutomationQueueItem[], allSelected: boolean): Set<string> {
  const next = new Set(current);
  items.forEach((item) => allSelected ? next.delete(item.id) : next.add(item.id));
  return next;
}

function isEditable(status: AutomationQueueItem['status']): boolean {
  return status === 'pending_approval' || status === 'letter_not_ready';
}

function isOpen(status: AutomationQueueItem['status']): boolean {
  return isEditable(status) || status === 'approved';
}
