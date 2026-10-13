import type { ReactElement } from 'react';
import { Info } from '@phosphor-icons/react';

export interface FirstRunSkipDialogProps {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function SkipDialogButtons({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
      <button
        type="button"
        className="first-run-btn-ghost"
        onClick={onCancel}
        data-testid="skip-cancel-btn"
      >
        Вернуться
      </button>
      <button
        type="button"
        className="first-run-btn-primary"
        style={{ background: 'var(--career-color-danger, #ef4444)' }}
        onClick={onConfirm}
        data-testid="skip-confirm-btn"
      >
        Пропустить
      </button>
    </div>
  );
}

export function FirstRunSkipDialog({
  isOpen,
  onCancel,
  onConfirm,
}: FirstRunSkipDialogProps): ReactElement | null {
  if (!isOpen) return null;

  return (
    <div
      className="first-run-modal-dim is-center"
      role="alertdialog"
      aria-labelledby="skip-dialog-title"
      aria-describedby="skip-dialog-desc"
      data-testid="first-run-skip-dialog"
    >
      <div className="first-run-alert">
        <h2 id="skip-dialog-title" style={{ margin: '0 0 8px', fontSize: 'var(--career-text-base, 16px)' }}>
          Пропустить шаг «Источник»?
        </h2>
        <p
          id="skip-dialog-desc"
          style={{
            margin: '0 0 16px',
            fontSize: 'var(--career-text-sm, 13px)',
            color: 'var(--career-color-sub, #475569)',
            lineHeight: 1.5,
          }}
        >
          Без источника профиль будет пустым, роли подберём только по цели. Подключить источник можно позже в «Аккаунт → Подключения».
        </p>
        <SkipDialogButtons onCancel={onCancel} onConfirm={onConfirm} />
      </div>
    </div>
  );
}

export interface FirstRunSkippedToastProps {
  readonly isVisible: boolean;
  readonly onUndo: () => void;
}

export function FirstRunSkippedToast({
  isVisible,
  onUndo,
}: FirstRunSkippedToastProps): ReactElement | null {
  if (!isVisible) return null;

  return (
    <div className="first-run-toast" role="status" data-testid="first-run-skipped-toast">
      <Info size={16} />
      <span>Источник пропущен. Подключить можно в «Аккаунт → Подключения».</span>
      <button
        type="button"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--career-color-primary, #38bdf8)',
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
        }}
        onClick={onUndo}
        data-testid="toast-undo-btn"
      >
        Вернуть
      </button>
    </div>
  );
}
