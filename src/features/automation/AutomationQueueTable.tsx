import { Check, EnvelopeSimple, Prohibit, X, type Icon } from '@phosphor-icons/react';
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

interface RowActionProps {
  readonly item: AutomationQueueItem;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly canApprove: boolean;
  readonly onAction: (action: AutomationQueueAction) => void;
  readonly onEdit: () => void;
}

const COLUMNS = ['Компания и роль', 'Канал', 'Совпадение', 'Уйдёт', 'Статус', 'Действия'] as const;

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
          {COLUMNS.map((label) => (
            <th scope="col" key={label}>
              {label}
            </th>
          ))}
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

function QueueTableRow(
  props: RowActionProps & { readonly selected: boolean; readonly onToggle: () => void },
) {
  const { item } = props;
  return (
    <tr className={props.selected ? 'is-selected' : undefined}>
      <td className="automation-queue-table-check">
        <input
          type="checkbox"
          aria-label={`Выбрать ${item.company}`}
          checked={props.selected}
          onChange={props.onToggle}
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
        <QueueTableActions {...props} />
      </td>
    </tr>
  );
}

function QueueIconButton({
  label,
  icon: IconComponent,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly icon: Icon;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <IconComponent size={18} aria-hidden="true" />
    </button>
  );
}

function QueueTableActions({ item, busy, enabled, canApprove, onAction, onEdit }: RowActionProps) {
  return (
    <div className="automation-queue-table-actions">
      {item.status === 'pending_approval' ? (
        <QueueIconButton
          label="Одобрить и отправить"
          icon={Check}
          disabled={busy || !enabled || !canApprove}
          onClick={() => onAction('approve_and_send')}
        />
      ) : null}
      {isEditable(item.status) ? (
        <QueueIconButton
          label="Править письмо"
          icon={EnvelopeSimple}
          disabled={busy}
          onClick={onEdit}
        />
      ) : null}
      {isOpen(item.status) ? (
        <QueueIconButton
          label="Снять с очереди"
          icon={X}
          disabled={busy}
          onClick={() => onAction('remove')}
        />
      ) : null}
      {isEditable(item.status) ? (
        <QueueIconButton
          label="В стоп-компании"
          icon={Prohibit}
          disabled={busy}
          onClick={() => onAction('stop_company')}
        />
      ) : null}
    </div>
  );
}
