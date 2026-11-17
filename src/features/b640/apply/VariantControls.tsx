import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  VARIANT_WISH_CHIPS,
  VARIANT_WISH_LABELS,
  VARIANT_WISH_MAX_LENGTH,
  type VariantWishChip,
} from '../../../../shared/textVariants';
import { Button, Icon, StatusLine, useIsMobile } from '../kit';
import type { LetterVariantsState } from './useLetterVariants';

/** Листание вариантов «‹ 2 из 3 ›»; у единственного текста листать нечего. */
export function VariantSwitch({ variants }: { readonly variants: LetterVariantsState }) {
  if (variants.total < 2) return null;
  const { index, total } = variants;
  return (
    <div className="var-sw" role="group" aria-label="Варианты письма">
      <button
        className="icon-btn"
        type="button"
        aria-label="Предыдущий вариант"
        disabled={index === 0}
        onClick={() => variants.select(index - 1)}
      >
        <Icon name="left" />
      </button>
      <span className="num">{`${index + 1} из ${total}`}</span>
      <button
        className="icon-btn"
        type="button"
        aria-label="Следующий вариант"
        disabled={index >= total - 1}
        onClick={() => variants.select(index + 1)}
      >
        <Icon name="right" />
      </button>
    </div>
  );
}

interface WishProps {
  readonly popId: string;
  readonly variants: LetterVariantsState;
}

interface ChipsProps {
  readonly labelledBy: string;
  readonly chips: readonly VariantWishChip[];
  readonly onToggle: (chip: VariantWishChip) => void;
}

function WishChips({ labelledBy, chips, onToggle }: ChipsProps) {
  return (
    <div className="chips va-pop-chips" role="group" aria-labelledby={labelledBy}>
      {VARIANT_WISH_CHIPS.map((chip) => (
        <button
          className="chip"
          type="button"
          key={chip}
          aria-pressed={chips.includes(chip)}
          onClick={() => onToggle(chip)}
        >
          {VARIANT_WISH_LABELS[chip]}
        </button>
      ))}
    </div>
  );
}

/** Esc закрывает всплывашку, фокус при открытии уходит в неё. */
function usePopFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return ref;
}

/** «Что поменять»: чипы и своё пожелание к другому варианту. */
function WishPop({ popId, variants }: WishProps) {
  const [chips, setChips] = useState<readonly VariantWishChip[]>([]);
  const [text, setText] = useState('');
  const ref = usePopFocus(() => variants.setWishOpen(false));
  const toggle = (chip: VariantWishChip) =>
    setChips(chips.includes(chip) ? chips.filter((item) => item !== chip) : [...chips, chip]);
  return (
    <div className="va-pop" id={popId} ref={ref} role="dialog" aria-labelledby={`${popId}-t`} tabIndex={-1}>
      <h3 className="va-pop-t" id={`${popId}-t`}>
        Что поменять
      </h3>
      <WishChips labelledBy={`${popId}-t`} chips={chips} onToggle={toggle} />
      <div className="va-pop-f">
        <label className="va-pop-l" htmlFor={`${popId}-w`}>
          Своё пожелание
        </label>
        <textarea
          id={`${popId}-w`}
          rows={2}
          maxLength={VARIANT_WISH_MAX_LENGTH}
          placeholder="Например, начать с результата"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </div>
      {variants.error ? <StatusLine state="err" text={variants.error} /> : null}
      <div className="va-pop-foot">
        <Button
          variant="primary"
          busy={variants.busy}
          onClick={() => variants.create({ chips, text: text.trim() })}
        >
          Сделать вариант
        </Button>
        <Button onClick={() => variants.setWishOpen(false)}>Отмена</Button>
      </div>
    </div>
  );
}

/** Кнопка «Другой вариант · N» со всплывашкой пожелания. Вариантов не осталось — кнопки нет. */
export function VariantButton({ variants }: { readonly variants: LetterVariantsState }) {
  const popId = useId();
  const mobile = useIsMobile();
  const wrap = useRef<HTMLSpanElement>(null);
  if (variants.remaining <= 0) return null;
  const pop = variants.wishOpen ? <WishPop popId={popId} variants={variants} /> : null;
  // На 390 лист встаёт в корень кабинета: внутри закреплённой полосы его закрыло бы затемнение.
  const root = mobile ? wrap.current?.closest('.b640') : null;
  return (
    <span className="va-popwrap" ref={wrap}>
      <button
        className="btn"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={variants.wishOpen}
        aria-controls={popId}
        onClick={() => variants.setWishOpen(!variants.wishOpen)}
      >
        <Icon name="refresh" />
        Другой вариант · <span className="num">{variants.remaining}</span>
      </button>
      {pop && root ? createPortal(pop, root) : pop}
    </span>
  );
}
