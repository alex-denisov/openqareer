import { useEffect, useRef } from 'react';
import { Link } from './Link';

export interface SecTab {
  readonly label: string;
  /** Подпись на 390: начало полной; остаток виден только на 1440 и 1176. */
  readonly shortLabel?: string;
  readonly path: string;
  readonly current: boolean;
}

export interface SecTabsProps {
  /** Подпись навигации для чтения с экрана: «Разделы профиля». */
  readonly label: string;
  readonly tabs: readonly SecTab[];
  readonly className?: string;
}

function TabLabel({ tab }: { readonly tab: SecTab }) {
  const short = tab.shortLabel;
  if (!short || !tab.label.startsWith(short) || short === tab.label) return <>{tab.label}</>;
  return (
    <span>
      {short}
      <span className="only-desk">{tab.label.slice(short.length)}</span>
    </span>
  );
}

/** Место под затухание у края строки: текущая вкладка под него не уходит. */
const FADE_ROOM = 40;

/**
 * Вкладки раздела над страницей. На 390 строка прокручивается: текущая вкладка
 * видна целиком, у края, за которым есть ещё вкладки, — затухание.
 */
export function SecTabs({ label, tabs, className }: SecTabsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const currentPath = tabs.find((tab) => tab.current)?.path;

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const current = row.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) {
      const right = current.offsetLeft - row.offsetLeft + current.offsetWidth;
      if (right > row.clientWidth - FADE_ROOM) row.scrollLeft = right - row.clientWidth + FADE_ROOM;
    }
    const mark = () => {
      const max = row.scrollWidth - row.clientWidth;
      row.classList.toggle('r6-fade-l', max > 1 && row.scrollLeft > 1);
      row.classList.toggle('r6-fade-r', max > 1 && row.scrollLeft < max - 1);
    };
    mark();
    row.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
    return () => {
      row.removeEventListener('scroll', mark);
      window.removeEventListener('resize', mark);
    };
  }, [currentPath]);

  return (
    <nav className={className ? `${className} sec-tabs` : 'sec-tabs'} aria-label={label}>
      <div className="sec-tabs-in" ref={rowRef}>
        {tabs.map((tab) => (
          <Link key={tab.path} to={tab.path} aria-current={tab.current ? 'page' : undefined}>
            <TabLabel tab={tab} />
          </Link>
        ))}
      </div>
    </nav>
  );
}
