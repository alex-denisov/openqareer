import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import {
  CaretDown,
  Check,
  Keyboard,
  Microphone,
  PaperPlaneTilt,
  Spinner,
} from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import './composer-mode.css';

export type ComposerInputMode = 'text' | 'voice';

interface ComposerModeSplitProps {
  readonly mode: ComposerInputMode;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly sendLabel: string;
  readonly onChooseMode: (mode: ComposerInputMode) => void;
}

const MODE_ITEMS: ReadonlyArray<{
  readonly mode: ComposerInputMode;
  readonly label: string;
}> = [
  { mode: 'voice', label: 'Голосовой ввод' },
  { mode: 'text', label: 'Текстовый ввод' },
];

function useMenuDismiss(
  open: boolean,
  close: () => void,
  rootRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
) {
  useEscapeLayer(() => {
    close();
    triggerRef.current?.focus();
  }, open);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open, close, rootRef]);
}

function ModeMenu({
  id,
  mode,
  onPick,
}: {
  readonly id: string;
  readonly mode: ComposerInputMode;
  readonly onPick: (mode: ComposerInputMode) => void;
}) {
  return (
    <div className="career-composer-menu" role="menu" id={id} aria-label="Способ ввода">
      {MODE_ITEMS.map((item) => (
        <button
          key={item.mode}
          type="button"
          role="menuitemradio"
          aria-checked={mode === item.mode}
          onClick={() => onPick(item.mode)}
        >
          {item.mode === 'voice' ? (
            <Microphone size={18} aria-hidden="true" />
          ) : (
            <Keyboard size={18} aria-hidden="true" />
          )}
          <span>{item.label}</span>
          {mode === item.mode ? <Check size={16} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Кнопка отправки со стрелкой выбора способа ввода (как в Telegram): меню из двух пунктов,
 * «Голосовой ввод» и «Текстовый ввод». Меню закрывается Escape, кликом вне и выбором пункта.
 */
export function ComposerModeSplit({
  mode,
  canSend,
  sending,
  sendLabel,
  onChooseMode,
}: ComposerModeSplitProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, rootRef, triggerRef);
  return (
    <div className="career-composer-split" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="career-composer-mode-trigger"
        aria-label="Способ ввода"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <CaretDown size="1em" aria-hidden="true" />
      </button>
      <button
        type="submit"
        className="career-composer-send career-expert-send"
        disabled={!canSend || sending}
        aria-label={sendLabel}
      >
        {sending ? <Spinner size={18} /> : <PaperPlaneTilt size={18} weight="regular" />}
      </button>
      {open ? (
        <ModeMenu
          id={menuId}
          mode={mode}
          onPick={(picked) => {
            close();
            onChooseMode(picked);
          }}
        />
      ) : null}
    </div>
  );
}
