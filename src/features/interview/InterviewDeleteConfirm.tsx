import { useEffect, useId, useRef } from 'react';
import { Trash, WarningCircle } from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import './interview-delete.css';

interface InterviewDeleteConfirmProps {
  readonly title: string;
  readonly detail: string;
  readonly confirmLabel: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** Фокус на время показа, затем обратно на кнопку, которая открыла диалог. */
function useFocusWhileOpen() {
  const target = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    target.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return target;
}

function DeleteError({ message }: { readonly message: string }) {
  return (
    <p className="career-interview-delete-error" role="alert">
      <WarningCircle size={16} aria-hidden="true" />
      {message}
    </p>
  );
}

/** Подтверждение удаления: фокус сразу на безопасном «Оставить», Escape закрывает только его. */
export function InterviewDeleteConfirm({
  title,
  detail,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: InterviewDeleteConfirmProps) {
  const titleId = useId();
  const cancelRef = useFocusWhileOpen();
  useEscapeLayer(onCancel, !busy);
  return (
    <section
      className="career-interview-delete-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <h3 id={titleId}>{title}</h3>
      <p>{detail}</p>
      {error ? <DeleteError message={error} /> : null}
      <div className="career-interview-delete-actions">
        <button
          ref={cancelRef}
          type="button"
          className="career-btn career-btn-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Оставить
        </button>
        <button
          type="button"
          className="career-btn career-interview-delete-go"
          disabled={busy}
          aria-busy={busy}
          onClick={onConfirm}
        >
          <Trash size={16} aria-hidden="true" />
          {busy ? 'Удаляем' : confirmLabel}
        </button>
      </div>
    </section>
  );
}
