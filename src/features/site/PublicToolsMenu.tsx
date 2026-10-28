import React from 'react';
import { PUBLIC_TOOLS, TOOLS_MENU_IDS } from '../../../shared/publicSiteChrome';

/**
 * B574: «Инструменты» in the header — a dropdown on wide screens and a group in
 * the phone menu. The trigger is a link to /#tools, so the item still works
 * before (or without) the bundle; once React runs it draws the list on
 * opening, which keeps the six links out of every page's HTML. Click
 * and Enter/Space open it, Escape or a click outside closes it.
 */
const SHELL_OPEN = 'data-ps-open';

/**
 * B574: a prerendered page runs its header with oq-chrome-2.js until the
 * bundle mounts, and that script notes the lists it opened on <html>. The
 * header React draws opens the same lists, then forgets the note so a later
 * page does not reopen them.
 */
export function openInShell(controls: string): boolean {
  if (typeof document === 'undefined') return false;
  const ids = (document.documentElement.getAttribute(SHELL_OPEN) ?? '').split(' ');
  if (!ids.includes(controls)) return false;
  const rest = ids.filter((id) => id && id !== controls).join(' ');
  document.documentElement.setAttribute(SHELL_OPEN, rest);
  return true;
}

/** Open state that Escape or a click outside `root` closes. */
function useDismissible(controls: string) {
  const [open, setOpen] = React.useState(() => openInShell(controls));
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLAnchorElement>(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);
  const toggle = () => setOpen((value) => !value);
  return { open, toggle, root, trigger };
}

export function PublicToolsMenu({
  where,
  current = false,
}: {
  readonly where: keyof typeof TOOLS_MENU_IDS;
  readonly current?: boolean;
}) {
  const { open, toggle, root, trigger } = useDismissible(TOOLS_MENU_IDS[where]);
  const id = TOOLS_MENU_IDS[where];
  return (
    <div className={`ps-tooldrop is-${where}`} ref={root}>
      <a
        ref={trigger}
        className="ps-tooldrop-trigger"
        href="/#tools"
        role="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-current={current ? 'true' : undefined}
        data-ps-disclosure=""
        onClick={(event) => {
          event.preventDefault();
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== ' ') return;
          event.preventDefault();
          toggle();
        }}
      >
        Инструменты
      </a>
      {open ? (
        <div className="ps-tooldrop-menu" id={id}>
          {PUBLIC_TOOLS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
