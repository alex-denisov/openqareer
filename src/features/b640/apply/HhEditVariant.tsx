import { Icon } from '../kit';
import type { HhEditVariants } from './useHhEditVariants';

interface ActionsProps {
  readonly variants: HhEditVariants;
  readonly disabled: boolean;
}

/** a01c: значок «Другой вариант» без окна пожелания. */
export function HhEditVariantButton({ variants, disabled }: ActionsProps) {
  const { busy, remaining } = variants;
  return (
    <button
      className="icon-btn"
      type="button"
      aria-label="Другой вариант"
      aria-busy={busy || undefined}
      disabled={disabled || busy || remaining <= 0}
      onClick={variants.create}
    >
      <Icon name="refresh" />
    </button>
  );
}

/** Листание появляется со вторым текстом; у единственного листать нечего. */
export function HhEditVariantSwitch({ variants, disabled }: ActionsProps) {
  const { index, total, busy } = variants;
  if (total < 2) return null;
  const locked = disabled || busy;
  return (
    <div className="var-sw" role="group" aria-label="Варианты правки">
      <button className="icon-btn" type="button" aria-label="Предыдущий вариант" disabled={locked || index === 0} onClick={() => variants.select(index - 1)}>
        <Icon name="left" />
      </button>
      <span className="num">{`${index + 1} из ${total}`}</span>
      <button className="icon-btn" type="button" aria-label="Следующий вариант" disabled={locked || index >= total - 1} onClick={() => variants.select(index + 1)}>
        <Icon name="right" />
      </button>
    </div>
  );
}

export function HhEditVariantError({ variants }: { readonly variants: HhEditVariants }) {
  if (!variants.error) return null;
  return (
    <p className="hh2-err" role="status">
      {variants.error}
    </p>
  );
}
