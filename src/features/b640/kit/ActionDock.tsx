import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export interface ActionDockProps {
  /** Одна залитая кнопка. */
  readonly primary: ReactNode;
  /** Не больше одной контурной кнопки. */
  readonly secondary?: ReactNode;
  /**
   * `dock` — отдельная панель (только 390); `commit` — блок действий формы, на 390 он закреплён;
   * `auto` — полоса действия объекта (`act-dock is-auto`): на 1440 и 1176 липнет к низу страницы,
   * на 390 закреплена над навигацией, кнопки делят её ширину поровну.
   */
  readonly kind?: 'dock' | 'commit' | 'auto';
}

const HEIGHT_VAR = '--career-m-commit-h';
const CLASS_OF = {
  dock: 'act-dock only-mob',
  commit: 'actions m-commit',
  auto: 'act-dock is-auto',
} as const;

/**
 * Закреплённая главная кнопка. На 390 полоса стоит над нижней навигацией;
 * высоту отдаём корню `.b640` в `--career-m-commit-h`, по ней `main` оставляет отступ.
 */
/** Высота закреплённой полосы уходит корню `.b640`: `main` оставляет под ней отступ. */
export function useDockHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    const root = element?.closest<HTMLElement>('.b640');
    if (!element || !root) return undefined;
    const measure = () =>
      root.style.setProperty(HEIGHT_VAR, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [ref]);
}

export function ActionDock({ primary, secondary, kind = 'dock' }: ActionDockProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDockHeight(ref);

  const className = CLASS_OF[kind];
  return (
    <div ref={ref} className={className}>
      {secondary}
      {primary}
    </div>
  );
}
