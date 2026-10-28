import React from 'react';
import { PUBLIC_TOOLS, TOOLS_MENU_IDS } from '../../../shared/publicSiteChrome';

/**
 * B574: «Инструменты» in the header — a dropdown on wide screens and a group in
 * the phone menu. The trigger is a link to /#tools, so the item still works
 * before (or without) the bundle; once React runs it draws the list on
 * opening, which keeps the six links out of every page's HTML. Click
 * and Enter/Space open it, Escape or a click outside closes it.
 */
/** Open state that Escape or a click outside `root` closes. */
function useDismissible() {
  const [open, setOpen] = React.useState(false);
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
  const { open, toggle, root, trigger } = useDismissible();
  const id = TOOLS_MENU_IDS[where];
  return (
    <div className={`ps-tools is-${where}`} ref={root}>
      <a
        ref={trigger}
        className="ps-tools-trigger"
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
        <div className="ps-tools-menu" id={id}>
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
