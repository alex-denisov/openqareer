import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../kit/Icon';
import type { B640Nav } from '../routes';
import { Link } from './Link';
import { BOTTOM_ITEMS, MORE_ITEMS } from './navigation';

export interface BottomNavProps {
  readonly active: B640Nav | null;
  readonly bellCount: number;
  /** Буква для круга «Аккаунт» в меню «Ещё». */
  readonly initial: string;
}

/** Нижняя навигация 390: пять равных колонок, пятая — меню «Ещё». */
export function BottomNav({ active, bellCount, initial }: BottomNavProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreActive = MORE_ITEMS.some((item) => item.id === active);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
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
          <Link
            key={item.id}
            role="menuitem"
            to={item.path}
            aria-current={item.id === active ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
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
        ))}
      </div>
    </>
  );
}
