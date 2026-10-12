import { Check, EnvelopeSimple, Prohibit, X } from '@phosphor-icons/react';
import type { AutomationQueueAction, AutomationQueueItem } from './automationApi';
import {
  automationDateLabel,
  automationPlatformLabel,
  automationQueueStatusLabel,
} from './automationFormat';

export interface AutomationQueueTableProps {
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
}

function isEditable(status: AutomationQueueItem['status']): boolean {
  return status === 'pending_approval' || status === 'letter_not_ready';
}

function isOpen(status: AutomationQueueItem['status']): boolean {
  return isEditable(status) || status === 'approved';
}

/** Desktop 1440 form of the queue (approved mockup 6); 390 keeps the cards. */
export function AutomationQueueTable(props: AutomationQueueTableProps) {
  return (
    <table className="automation-queue-table" aria-label="Записи очереди">
      <thead>
        <tr>
          <th scope="col" className="automation-queue-table-check">
            <input
              type="checkbox"
              aria-label="Отметить все строки таблицы"
              checked={props.allSelected}
              onChange={props.onToggleAll}
            />
          </th>
          <th scope="col">Компания и роль</th>
          <th scope="col">Канал</th>
          <th scope="col">Совпадение</th>
          <th scope="col">Уйдёт</th>
          <th scope="col">Статус</th>
          <th scope="col">Действия</th>
        </tr>
      </thead>
      <tbody>
        {props.items.map((item) => (
          <QueueTableRow
            key={item.id}
            item={item}
            selected={props.selected.has(item.id)}
            busy={props.busyId === item.id}
            enabled={props.enabled}
            canApprove={props.canApprove}
            onToggle={() => props.onToggleItem(item.id)}
            onAction={(action) => props.onAction(item, action)}
            onEdit={() => props.onEdit(item)}
          />
        ))}
      </tbody>
    </table>
  );
}

function QueueTableRow({
  item,
  selected,
  busy,
  enabled,
  canApprove,
  onToggle,
  onAction,
  onEdit,
}: {
  readonly item: AutomationQueueItem;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly canApprove: boolean;
  readonly onToggle: () => void;
  readonly onAction: (action: AutomationQueueAction) => void;
  readonly onEdit: () => void;
}) {
  return (
    <tr className={selected ? 'is-selected' : undefined}>
      <td className="automation-queue-table-check">
        <input
          type="checkbox"
          aria-label={`Выбрать ${item.company}`}
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <th scope="row">
        <strong>{item.company}</strong>
        <span>{item.role || item.title}</span>
      </th>
      <td>{automationPlatformLabel(item.platform)}</td>
      <td>
        {item.requirements.matched} из {item.requirements.total}
      </td>
      <td>
        {item.sendTiming === 'today' ? 'Сегодня' : 'Позже'}
        <span>{automationDateLabel(item.updatedAt)}</span>
      </td>
      <td>
        <span className="automation-queue-status">{automationQueueStatusLabel(item.status)}</span>
      </td>
      <td>
        <div className="automation-queue-table-actions">
          {item.status === 'pending_approval' ? (
            <button
              type="button"
              aria-label="Одобрить и отправить"
              title="Одобрить и отправить"
              disabled={busy || !enabled || !canApprove}
              onClick={() => onAction('approve_and_send')}
            >
              <Check size={18} aria-hidden="true" />
            </button>
          ) : null}
          {isEditable(item.status) ? (
            <button
              type="button"
              aria-label="Править письмо"
              title="Править письмо"
              disabled={busy}
              onClick={onEdit}
            >
              <EnvelopeSimple size={18} aria-hidden="true" />
            </button>
          ) : null}
          {isOpen(item.status) ? (
            <button
              type="button"
              aria-label="Снять с очереди"
              title="Снять с очереди"
              disabled={busy}
              onClick={() => onAction('remove')}
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
          {isEditable(item.status) ? (
            <button
              type="button"
              aria-label="В стоп-компании"
              title="В стоп-компании"
              disabled={busy}
              onClick={() => onAction('stop_company')}
            >
              <Prohibit size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
