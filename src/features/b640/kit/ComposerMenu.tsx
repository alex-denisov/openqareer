import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { ComposerMode } from './useVoiceMode';

const MODES = [
  { id: 'text', label: 'Текстом' },
  { id: 'voice', label: 'Голосом' },
] as const;

export interface ComposerMenuProps {
  readonly id: string;
  readonly mode: ComposerMode;
  readonly onChoose: (mode: ComposerMode) => void;
}

/** Меню «Текстом / Голосом» у кнопки отправки. */
export function ComposerMenu({ id, mode, onChoose }: ComposerMenuProps) {
  const caret = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: Event) => {
      if (!caret.current?.parentElement?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  function pick(next: ComposerMode) {
    setOpen(false);
    caret.current?.focus();
    onChoose(next);
  }

  return (
    <span className="cmp-mode">
      <button
        ref={caret}
        className="cmp-caret"
        type="button"
        aria-label={`Способ ввода: ${mode === 'voice' ? 'голосом' : 'текстом'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="down" />
      </button>
      <span className="cmp-menu" id={id} role="menu" hidden={!open}>
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitemradio"
            aria-checked={mode === item.id}
            onClick={() => pick(item.id)}
            onKeyDown={(event) => event.key === 'Escape' && pick(mode)}
          >
            {item.label}
          </button>
        ))}
      </span>
    </span>
  );
}
