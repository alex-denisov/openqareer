import { useLayoutEffect, useRef } from 'react';

/**
 * Заполнение шкалы `.meter > i` в процентах. Атрибут `style` политика страницы не пускает,
 * поэтому ширина ставится свойством узла, как в `BarPart`.
 */
export function MeterFill({ percent }: { readonly percent: number }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    ref.current?.style.setProperty('inline-size', `${Math.min(100, Math.max(0, percent))}%`);
  }, [percent]);
  return <i ref={ref} />;
}
