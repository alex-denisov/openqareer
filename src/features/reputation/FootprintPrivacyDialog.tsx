import { X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';

/**
 * Макет 2: the tag «Видите только вы» opens consent and data controls — revoke
 * the consent and delete saved findings, each behind its own confirmation (B544).
 */
export function FootprintPrivacyDialog({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);
  const close = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    else onClose();
  };
  useEscapeLayer(close);
  return (
    <dialog
      ref={dialogRef}
      id="profile-footprint-privacy-controls"
      className="career-modal-card profile-footprint-privacy-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <header className="career-modal-header">
        <div>
          <h2 id={titleId}>Видите только вы</h2>
          <p className="career-modal-intro">
            Находки видите только вы. До подтверждения они не попадают в профиль и отклики.
          </p>
        </div>
        <button
          type="button"
          className="career-modal-close"
          aria-label="Закрыть управление данными"
          onClick={close}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="profile-footprint-privacy-controls">{children}</div>
    </dialog>
  );
}
