import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  /** Подвал: главная и вторая кнопка. */
  readonly footer?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** Всё в корне, кроме окна, фона и тоста, делается `inert`; возвращает отмену. */
function isolate(root: HTMLElement, keep: readonly (HTMLElement | null)[]): () => void {
  const changed = Array.from(root.children).filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement &&
      !keep.includes(node) &&
      !node.hasAttribute('data-kit-keep') &&
      !node.hasAttribute('inert'),
  );
  changed.forEach((node) => node.setAttribute('inert', ''));
  return () => changed.forEach((node) => node.removeAttribute('inert'));
}

/**
 * Окно на 1440/1176 и нижний лист на 390. Рисуется внутри корня `.b640`:
 * стили действуют только под ним. Фокус уходит в окно и возвращается на открывшую кнопку.
 */
export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  const titleId = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setHost(anchor.current?.closest<HTMLElement>('.b640') ?? null);
  }, []);

  const shown = open && host !== null;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!shown || !host || !dialog) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = isolate(host, [dialog, backRef.current]);
    (focusables(dialog.querySelector('.pf-db') as HTMLElement)[0] ?? dialog).focus();
    return () => {
      release();
      opener?.focus();
    };
  }, [shown, host]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(event.currentTarget);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <span ref={anchor} hidden />
      {shown
        ? createPortal(
            <>
              <div ref={backRef} className="pf-back" aria-hidden="true" onClick={onClose} />
              <div
                ref={dialogRef}
                className="pf-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onKeyDown={onKeyDown}
              >
                <span className="grab" aria-hidden="true" />
                <div className="pf-dh">
                  <h2 id={titleId}>{title}</h2>
                  <button className="icon-btn" type="button" aria-label="Закрыть" onClick={onClose}>
                    <Icon name="close" />
                  </button>
                </div>
                <div className="pf-db">{children}</div>
                {footer ? <div className="pf-df">{footer}</div> : null}
              </div>
            </>,
            host,
          )
        : null}
    </>
  );
}
