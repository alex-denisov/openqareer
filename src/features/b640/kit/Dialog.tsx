import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useModalFocus } from './useModalFocus';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  /** Подвал: главная и вторая кнопка. */
  readonly footer?: ReactNode;
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
  useModalFocus(shown, { host, dialog: dialogRef, back: backRef }, onClose);

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
