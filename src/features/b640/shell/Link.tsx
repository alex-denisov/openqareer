import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useShell } from './ShellContext';

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Адрес внутри кабинета: `/app/...`. */
  readonly to: string;
}

/** Ссылка внутри кабинета: обычное нажатие меняет адрес без перезагрузки страницы. */
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useShell();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== '_self') return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a {...rest} href={to} onClick={handleClick}>
      {children}
    </a>
  );
}
