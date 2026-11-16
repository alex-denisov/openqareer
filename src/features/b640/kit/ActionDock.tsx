import { useEffect, useRef, type ReactNode } from 'react';

export interface ActionDockProps {
  /** Одна залитая кнопка. */
  readonly primary: ReactNode;
  /** Не больше одной контурной кнопки. */
  readonly secondary?: ReactNode;
  /** `dock` — отдельная панель (только 390), `commit` — блок действий формы, на 390 он закреплён. */
  readonly kind?: 'dock' | 'commit';
}

const HEIGHT_VAR = '--career-m-commit-h';

/**
 * Закреплённая главная кнопка. На 390 полоса стоит над нижней навигацией;
 * высоту отдаём корню `.b640` в `--career-m-commit-h`, по ней `main` оставляет отступ.
 */
export function ActionDock({ primary, secondary, kind = 'dock' }: ActionDockProps) {
  const ref = useRef<HTMLDivElement>(null);

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
  }, []);

  const className = kind === 'dock' ? 'act-dock only-mob' : 'actions m-commit';
  return (
    <div ref={ref} className={className}>
      {secondary}
      {primary}
    </div>
  );
}
