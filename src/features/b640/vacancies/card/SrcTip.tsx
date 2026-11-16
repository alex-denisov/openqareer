import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../kit';

export interface SrcTipProps {
  readonly label: string;
  readonly text: string;
}

/** ⓘ с источником числа: раскрывается по нажатию, закрывается по Esc и нажатию мимо. */
export function SrcTip({ label, text }: SrcTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onPointer = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onPointer);
    };
  }, [open]);

  return (
    <span ref={root} className="v4-src">
      <button
        className="icon-btn info"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="info" />
      </button>
      <span className="v4-pop" id={id} role="note" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
