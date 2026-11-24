import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { WishPop, type VariantControlsState } from '../apply/VariantControls';
import { Icon } from '../kit/Icon';
import { useIsMobile } from '../kit/useMediaQuery';

interface ButtonProps {
  readonly variants: VariantControlsState;
  readonly popId: string;
  readonly disabled: boolean;
}

/** K6: «Другой вариант» в ряду действий; вариантов не осталось — кнопки нет, листание остаётся. */
export function ResumeEditVariantButton({ variants, popId, disabled }: ButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const open = variants.wishOpen;
  const wasOpen = useRef(open);
  // Закрыли «Что поменять» — фокус возвращается на кнопку, которая её открыла.
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  if (variants.remaining <= 0) return null;
  return (
    <button
      ref={button}
      className="btn is-sm is-line ec-ib"
      type="button"
      aria-label="Другой вариант"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={popId}
      disabled={disabled}
      onClick={() => variants.setWishOpen(!open)}
    >
      <Icon name="refresh" />
      <span className="ec-ib-l">Другой вариант</span>
      <span className="ec-tip" role="tooltip" aria-hidden="true">
        Другой вариант
      </span>
    </button>
  );
}

interface PopProps {
  readonly variants: VariantControlsState;
  readonly popId: string;
  readonly card: RefObject<HTMLElement>;
}

/** «Что поменять»: в карточке, на 390 — листом в корне кабинета. Esc закрывает её, а не панель. */
export function ResumeEditWish({ variants, popId, card }: PopProps) {
  const mobile = useIsMobile();
  useEffect(() => {
    if (!variants.wishOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [variants.wishOpen]);
  if (!variants.wishOpen) return null;
  const root = mobile ? card.current?.closest('.b640') : null;
  const pop = <WishPop popId={popId} variants={variants} />;
  return root ? createPortal(pop, root) : pop;
}
