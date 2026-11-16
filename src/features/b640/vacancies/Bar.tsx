import { useLayoutEffect, useRef } from 'react';

export interface BarPartProps {
  readonly className?: string;
  /** Ширина в процентах шкалы, 0–100. */
  readonly size?: number;
  /** Отступ от начала шкалы в процентах, 0–100. */
  readonly start?: number;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Деление шкалы макета (`.v4-fit-bar > span`, `.vs-fork`, `.vg-me`). Атрибут `style`
 * политика страницы не пускает, поэтому размер и отступ ставятся свойствами узла.
 */
export function BarPart({ className, size, start }: BarPartProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (size === undefined) node.style.removeProperty('inline-size');
    else node.style.setProperty('inline-size', `${clamp(size)}%`);
    if (start === undefined) node.style.removeProperty('inset-inline-start');
    else node.style.setProperty('inset-inline-start', `${clamp(start)}%`);
  }, [size, start]);
  return <span ref={ref} className={className} />;
}
