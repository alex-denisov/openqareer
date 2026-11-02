import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

export interface CompanyWantsMenuItem {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/** Popover menu for row «⋯», «Сменить статус» and the 390 «Действия» button. */
export function CompanyWantsMenu({
  trigger,
  triggerClassName,
  triggerLabel,
  items,
  disabled = false,
}: {
  readonly trigger: ReactNode;
  readonly triggerClassName: string;
  readonly triggerLabel?: string;
  readonly items: readonly CompanyWantsMenuItem[];
  readonly disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, root);
  return (
    <div className="career-company-wants-menu-root" ref={root}>
      <button
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open ? <MenuItems items={items} onPicked={() => setOpen(false)} /> : null}
    </div>
  );
}

function MenuItems({
  items,
  onPicked,
}: {
  readonly items: readonly CompanyWantsMenuItem[];
  readonly onPicked: () => void;
}) {
  return (
    <div className="career-company-wants-menu" role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onPicked();
            item.onSelect();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function useDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  root: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open, setOpen, root]);
}
