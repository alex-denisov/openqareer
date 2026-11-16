import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../kit/Icon';
import type { B640Nav } from '../routes';
import { Link } from './Link';
import { BOTTOM_ITEMS, MORE_ITEMS, type NavItem } from './navigation';

export interface BottomNavProps {
  readonly active: B640Nav | null;
  readonly bellCount: number;
  /** Буква для круга «Аккаунт» в меню «Ещё». */
  readonly initial: string;
}

/** Стрелки, Home и End переносят фокус между пунктами меню по кругу. */
const MENU_KEYS: Readonly<Record<string, (current: number, last: number) => number>> = {
  ArrowDown: (current, last) => (current >= last ? 0 : current + 1),
  ArrowUp: (current, last) => (current <= 0 ? last : current - 1),
  Home: () => 0,
  End: (_current, last) => last,
};

/** Меню «Ещё»: открывается кнопкой, закрывается повторным нажатием, Esc и нажатием мимо. */
function useMoreMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      // Tab уводит фокус из меню: меню закрывается, а не остаётся открытым позади.
      if (event.key === 'Tab') {
        setOpen(false);
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      const current = items.indexOf(document.activeElement as HTMLElement);
      const last = items.length - 1;
      const next = MENU_KEYS[event.key]?.(current, last);
      if (next === undefined) return;
      event.preventDefault();
      items[next]?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return { open, setOpen, buttonRef, menuRef };
}

function MoreItem({
  item,
  active,
  bellCount,
  initial,
  onPick,
}: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly bellCount: number;
  readonly initial: string;
  readonly onPick: () => void;
}) {
  return (
    <Link role="menuitem" to={item.path} aria-current={active ? 'page' : undefined} onClick={onPick}>
      {item.id === 'settings' ? (
        <span className="av-ini" aria-hidden="true">
          {initial}
        </span>
      ) : (
        <Icon name={item.icon} />
      )}
      <span>{item.label}</span>
      {item.id === 'bell' && bellCount ? (
        <span className="num">
          {bellCount}
          <span className="vh"> новых</span>
        </span>
      ) : null}
    </Link>
  );
}

/** Нижняя навигация 390: пять равных колонок, пятая — меню «Ещё». */
export function BottomNav({ active, bellCount, initial }: BottomNavProps) {
  const { open, setOpen, buttonRef, menuRef } = useMoreMenu();
  const menuId = useId();
  const moreActive = MORE_ITEMS.some((item) => item.id === active);
  return (
    <>
      <nav className="bottomnav" aria-label="Разделы">
        {BOTTOM_ITEMS.map((item) => (
          <Link key={item.id} to={item.path} aria-current={item.id === active ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
        <button
          ref={buttonRef}
          className="more-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="more" />
          <span>Ещё</span>
        </button>
      </nav>
      <div
        ref={menuRef}
        className="more-menu"
        role="menu"
        id={menuId}
        aria-label="Ещё разделы"
        hidden={!open}
      >
        {MORE_ITEMS.map((item) => (
          <MoreItem
            key={item.id}
            item={item}
            active={item.id === active}
            bellCount={bellCount}
            initial={initial}
            onPick={() => setOpen(false)}
          />
        ))}
      </div>
    </>
  );
}
