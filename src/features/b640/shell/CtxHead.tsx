import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../kit/Icon';
import { useIsMobile } from '../kit/useMediaQuery';
import { Link } from './Link';
import { useScreenChrome, useShell } from './ShellContext';

export interface CtxHeadProps {
  /** Вид объекта: «Отклик», «Вакансия». */
  readonly kind: string;
  /** Сам объект: «Head of Engineering · Гринкод · удалённо». */
  readonly title: string;
  /** Свойства объекта строками: вилка, площадка, дата. */
  readonly meta?: readonly string[];
  /** Ссылка на экран объекта. */
  readonly open?: { readonly path: string; readonly label: string };
  readonly children?: ReactNode;
}

/**
 * Шапка контекста рабочего экрана: над чем идёт работа. На 1440 и 1176 встаёт
 * в путь вместо средних звеньев, на 390 — первой строкой страницы.
 */
export function CtxHead({ kind, title, meta, open, children }: CtxHeadProps) {
  useScreenChrome({ hasContextHead: true });
  const { ctxSlot } = useShell();
  const mobile = useIsMobile();
  const head = (
    <details className="ctx-head ctx-one col-wide">
      <summary aria-label={`${kind}: ${title}`}>
        <span className="ctx-kind">{kind}</span>
        <span className="ctx-title">{title}</span>
        <Icon name="down" className="ctx-chev" />
      </summary>
      <div className="ctx-more">
        {meta?.length ? (
          <ul className="ctx-meta">
            {meta.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {open ? (
          <Link className="row-act ctx-open" to={open.path}>
            <Icon name="right" />
            {open.label}
          </Link>
        ) : null}
        {children}
      </div>
    </details>
  );
  return !mobile && ctxSlot ? createPortal(head, ctxSlot) : head;
}
