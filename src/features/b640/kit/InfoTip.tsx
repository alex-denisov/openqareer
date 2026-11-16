import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface InfoTipProps {
  /** Подпись кнопки для экранного чтеца. */
  readonly label: string;
  readonly text: string;
}

/**
 * ⓘ с подсказкой. Наведение и фокус показывает CSS макета; нажатие закрепляет
 * подсказку (на телефоне наведения нет), повторное нажатие, Esc и нажатие мимо снимают.
 */
export function InfoTip({ label, text }: InfoTipProps) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pinned) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(false);
    };
    const onPointer = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onPointer);
    };
  }, [pinned]);

  return (
    <span ref={root} className={pinned ? 'tip kit-pinned' : 'tip'}>
      <button
        className="icon-btn info"
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => setPinned((value) => !value)}
      >
        <Icon name="info" />
      </button>
      <span className="tip-bubble" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
