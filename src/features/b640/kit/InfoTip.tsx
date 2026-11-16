import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Icon } from './Icon';

export interface InfoTipProps {
  /** Подпись кнопки для экранного чтеца. */
  readonly label: string;
  readonly text: string;
}

/** Закреплённая подсказка снимается по Esc и нажатию мимо. */
function useUnpinOnOutside(pinned: boolean, root: RefObject<HTMLElement>, unpin: () => void): void {
  useEffect(() => {
    if (!pinned) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') unpin();
    };
    const onPointer = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) unpin();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onPointer);
    };
  }, [pinned, root, unpin]);
}

/**
 * ⓘ с подсказкой. Наведение и фокус показывает CSS макета; нажатие закрепляет
 * подсказку (на телефоне наведения нет), повторное нажатие, Esc и нажатие мимо снимают.
 */
export function InfoTip({ label, text }: InfoTipProps) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useUnpinOnOutside(pinned, root, () => setPinned(false));

  return (
    <span
      ref={root}
      className={pinned ? 'tip kit-pinned' : dismissed ? 'tip kit-dismissed' : 'tip'}
    >
      <button
        className="icon-btn info"
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => {
          setDismissed(false);
          setPinned((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          setPinned(false);
          setDismissed(true);
        }}
        onBlur={() => setDismissed(false)}
        onPointerLeave={() => setDismissed(false)}
      >
        <Icon name="info" />
      </button>
      <span className="tip-bubble" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
