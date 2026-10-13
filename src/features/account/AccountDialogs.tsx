import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { registerEscapeLayer } from '../shell/escapeLayers';
import type { CandidateConnection } from '../coach/coachApi';

interface DialogScrimProps {
  readonly children: ReactNode;
  readonly onClose: () => void;
}

function DialogScrim({ children, onClose }: DialogScrimProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = root.current?.querySelector<HTMLElement>('.career-account-dialog');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const first = focusable()[0];
    first?.focus();
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const firstItem = items[0];
      const lastItem = items.at(-1);
      if (!firstItem || !lastItem) return;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener('keydown', handleTab);
    const unregisterEscape = registerEscapeLayer(onClose);
    return () => {
      window.removeEventListener('keydown', handleTab);
      unregisterEscape();
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [onClose]);

  return (
    <div ref={root} className="career-account-dialog-scrim" role="presentation">
      <button
        type="button"
        className="career-account-dialog-backdrop"
        aria-label="Закрыть"
        onClick={onClose}
        tabIndex={-1}
      />
      {children}
    </div>
  );
}

export function AccountFormDialog({
  title,
  titleId,
  description,
  onClose,
  children,
}: {
  readonly title: string;
  readonly titleId: string;
  readonly description?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <DialogScrim onClose={onClose}>
      <div className="career-account-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="career-account-card-header">
          <h3 id={titleId} className="career-account-card-title">{title}</h3>
          <button type="button" className="career-btn is-ghost is-icon" onClick={onClose} aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {description ? <p className="career-account-lead">{description}</p> : null}
        {children}
      </div>
    </DialogScrim>
  );
}

interface ConfirmDialogProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly isDanger?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function AccountConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  isDanger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <DialogScrim onClose={onCancel}>
      <div
        className="career-account-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-desc"
      >
        <h3 id="dialog-title" className="career-account-card-title">
          {title}
        </h3>
        <p id="dialog-desc" className="career-account-lead">
          {description}
        </p>
        <div className="career-account-dialog-actions">
          <button type="button" className="career-btn is-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`career-btn ${isDanger ? 'is-danger' : 'is-primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </DialogScrim>
  );
}

interface ConnectionModalProps {
  readonly connection: Extract<CandidateConnection, { status: 'connected' }>;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onDisconnect: () => void;
  readonly onReimport: () => void;
}

function connectionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function LinkedInModalContent({
  connection,
}: {
  readonly connection: Extract<CandidateConnection, { status: 'connected' }>;
}) {
  return (
    <div className="career-account-rows">
      <div className="career-account-card-title-wrap">
        <span className="career-account-tag is-ok">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          Подключено
        </span>
        <span className="career-account-row-desc">
          вход сохранён в приложении · подключено {connectionDate(connection.connectedAt)}
        </span>
      </div>
      <p className="career-account-row-desc">
        Импортировано {connection.factCount} фактов · {connectionDate(connection.lastImportedAt)}.
      </p>
      <label className="career-account-row" aria-disabled="true">
        <span className="career-account-row-label">
          Использовать контакты для маршрутов к компаниям. Настройка пока недоступна.
        </span>
        <input type="checkbox" disabled aria-label="Использовать контакты для маршрутов к компаниям" />
      </label>
      <label className="career-account-row" aria-disabled="true">
        <span className="career-account-row-label">Готовить черновики постов. Настройка пока недоступна.</span>
        <input type="checkbox" disabled aria-label="Готовить черновики постов" />
      </label>
    </div>
  );
}

export function AccountLinkedInModal({
  connection,
  busy,
  onClose,
  onDisconnect,
  onReimport,
}: ConnectionModalProps) {
  return (
    <DialogScrim onClose={onClose}>
      <div
        className="career-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="li-modal-title"
      >
        <div className="career-account-card-header">
          <h3 id="li-modal-title" className="career-account-card-title">
            LinkedIn
          </h3>
          <button
            type="button"
            className="career-btn is-ghost is-icon"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <LinkedInModalContent connection={connection} />
        <div className="career-account-dialog-actions">
          <button type="button" className="career-btn is-danger" disabled={busy} onClick={onDisconnect}>
            Отключить
          </button>
          <button type="button" className="career-btn" disabled={busy} onClick={onReimport}>
            <ArrowsClockwise size={16} aria-hidden="true" />
            Импортировать заново
          </button>
        </div>
      </div>
    </DialogScrim>
  );
}

function HhModalContent({
  connection,
}: {
  readonly connection: Extract<CandidateConnection, { status: 'connected' }>;
}) {
  return (
    <div className="career-account-rows">
      <div className="career-account-card-title-wrap">
        <span className="career-account-tag is-warn">
          <WarningCircle size={14} weight="fill" aria-hidden="true" />
          Частично
        </span>
        <span className="career-account-row-desc">
          подключено <span className="career-account-num">{connectionDate(connection.connectedAt)}</span>
        </span>
      </div>
      <div className="career-account-row">
        <span className="career-account-row-desc">
          Импортировано {connection.factCount} фактов · последний импорт {connectionDate(connection.lastImportedAt)}.
        </span>
      </div>
      <label className="career-account-row" aria-disabled="true">
        <span className="career-account-row-label">
          Отправлять отклики через этот аккаунт после одобрения. Настройка пока недоступна.
        </span>
        <input type="checkbox" disabled aria-label="Отправлять отклики через этот аккаунт после одобрения" />
      </label>
    </div>
  );
}

export function AccountHhModal({
  connection,
  busy,
  onClose,
  onDisconnect,
  onReimport,
}: ConnectionModalProps) {
  return (
    <DialogScrim onClose={onClose}>
      <div
        className="career-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hh-modal-title"
      >
        <div className="career-account-card-header">
          <h3 id="hh-modal-title" className="career-account-card-title">
            hh.ru
          </h3>
          <button
            type="button"
            className="career-btn is-ghost is-icon"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <HhModalContent connection={connection} />
        <div className="career-account-dialog-actions">
          <button type="button" className="career-btn is-danger" disabled={busy} onClick={onDisconnect}>
            Отключить
          </button>
          <button type="button" className="career-btn" disabled={busy} onClick={onReimport}>
            <ArrowsClockwise size={16} aria-hidden="true" />
            Повторить импорт
          </button>
        </div>
      </div>
    </DialogScrim>
  );
}
