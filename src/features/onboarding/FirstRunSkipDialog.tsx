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
    <div className="first-run-skip-actions">
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
        <h2 id="skip-dialog-title" className="first-run-skip-title">
          Пропустить шаг «Источник»?
        </h2>
        <p id="skip-dialog-desc" className="first-run-skip-description">
          Без источника резюме пока не появится в профиле. Можно продолжить с целью и контекстом, а подключить источник позже в «Аккаунт → Подключения».
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
        className="first-run-toast-undo"
        onClick={onUndo}
        data-testid="toast-undo-btn"
      >
        Вернуть
      </button>
    </div>
  );
}
