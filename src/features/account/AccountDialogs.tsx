import type { ReactNode } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

interface DialogScrimProps {
  readonly children: ReactNode;
  readonly onClose: () => void;
}

function DialogScrim({ children, onClose }: DialogScrimProps) {
  return (
    <div className="career-account-dialog-scrim" role="presentation">
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

interface ConfirmDialogProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly isDanger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function AccountConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  isDanger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <DialogScrim onClose={onCancel}>
      <div
        className="career-account-dialog"
        role="alertdialog"
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
          <button type="button" className="career-btn is-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`career-btn ${isDanger ? 'is-danger' : 'is-primary'}`}
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
  readonly onClose: () => void;
  readonly onDisconnect: () => void;
  readonly onReimport: () => void;
}

function LinkedInModalContent() {
  return (
    <div className="career-account-rows">
      <div className="career-account-card-title-wrap">
        <span className="career-account-tag is-ok">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          Подключено
        </span>
        <span className="career-account-row-desc">
          вход сохранён до <span className="career-account-num">10.10</span>
        </span>
      </div>
      <p className="career-account-row-desc">
        Импортировано <span className="career-account-num">9 из 9</span> мест работы,{' '}
        <span className="career-account-num">12.09</span>. Контакты:{' '}
        <span className="career-account-num">412</span>, импорт{' '}
        <span className="career-account-num">12.09</span>.
      </p>
      <label className="career-account-row">
        <span className="career-account-row-label">
          Использовать контакты для маршрутов к компаниям
        </span>
        <input type="checkbox" defaultChecked />
      </label>
      <label className="career-account-row">
        <span className="career-account-row-label">Готовить черновики постов</span>
        <input type="checkbox" defaultChecked />
      </label>
    </div>
  );
}

export function AccountLinkedInModal({
  onClose,
  onDisconnect,
  onReimport,
}: ConnectionModalProps) {
  return (
    <DialogScrim onClose={onClose}>
      <div
        className="career-account-dialog"
        role="dialog"
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
        <LinkedInModalContent />
        <div className="career-account-dialog-actions">
          <button type="button" className="career-btn is-danger" onClick={onDisconnect}>
            Отключить
          </button>
          <button type="button" className="career-btn" onClick={onReimport}>
            <ArrowsClockwise size={16} aria-hidden="true" />
            Импортировать заново
          </button>
        </div>
      </div>
    </DialogScrim>
  );
}

function HhModalContent() {
  return (
    <div className="career-account-rows">
      <div className="career-account-card-title-wrap">
        <span className="career-account-tag is-warn">
          <WarningCircle size={14} weight="fill" aria-hidden="true" />
          Частично
        </span>
        <span className="career-account-row-desc">
          подключено <span className="career-account-num">07.10</span>
        </span>
      </div>
      <div className="career-account-row">
        <span className="career-account-row-desc">
          Импортировано 8 из 9 мест работы: «Практика-Эксперт» не прочитано, площадка не ответила.
        </span>
      </div>
      <label className="career-account-row">
        <span className="career-account-row-label">
          Отправлять отклики через этот аккаунт после одобрения
        </span>
        <input type="checkbox" defaultChecked />
      </label>
    </div>
  );
}

export function AccountHhModal({
  onClose,
  onDisconnect,
  onReimport,
}: ConnectionModalProps) {
  return (
    <DialogScrim onClose={onClose}>
      <div
        className="career-account-dialog"
        role="dialog"
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
        <HhModalContent />
        <div className="career-account-dialog-actions">
          <button type="button" className="career-btn is-danger" onClick={onDisconnect}>
            Отключить
          </button>
          <button type="button" className="career-btn" onClick={onReimport}>
            <ArrowsClockwise size={16} aria-hidden="true" />
            Повторить импорт
          </button>
        </div>
      </div>
    </DialogScrim>
  );
}
