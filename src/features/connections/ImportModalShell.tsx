import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

interface ImportModalShellProps {
  readonly isOpen: boolean;
  readonly titleId: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly wide?: boolean;
}

/**
 * One shell for every connector dialog.
 *
 * It renders into `document.body` rather than next to the card that opened it:
 * a dialog nested inside the wizard depends on every ancestor keeping its
 * stacking and containing block innocent — one `transform`, `filter` or
 * `contain` anywhere above it and `position: fixed` silently stops meaning
 * "the viewport", which is exactly how a dialog turns into "nothing happens"
 * (B148 §2). A portal removes that whole class of failure.
 *
 * Escape and a click on the backdrop close it, so the candidate is never
 * trapped in a connector they changed their mind about.
 */
// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function ImportModalShell({
  isOpen,
  titleId,
  title,
  icon,
  onClose,
  children,
  wide = false,
}: ImportModalShellProps) {
  const card = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const returnFocusTo =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      returnFocusTo?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const dialog = (
    <div
      className="career-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!card.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        className={`career-modal-card${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={card}
      >
        <div className="career-modal-header">
          <div className="career-modal-title">
            {icon}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="career-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
            ref={closeButton}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  // Static rendering (the prerender step and the SSR component tests) has no
  // document to portal into; the markup is identical either way.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
