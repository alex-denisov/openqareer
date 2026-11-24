import { Icon } from '../kit';
import type { HhEditVariants } from './useHhEditVariants';

interface ActionsProps {
  readonly variants: HhEditVariants;
  readonly disabled: boolean;
}

/** a01c: значок «Другой вариант» без окна пожелания; листание появляется со вторым текстом. */
export function HhEditVariantActions({ variants, disabled }: ActionsProps) {
  const { index, total, busy, remaining } = variants;
  const locked = disabled || busy;
  return (
    <>
      {total > 1 ? (
        <div className="var-sw" role="group" aria-label="Варианты правки">
          <button className="icon-btn" type="button" aria-label="Предыдущий вариант" disabled={locked || index === 0} onClick={() => variants.select(index - 1)}>
            <Icon name="left" />
          </button>
          <span className="num">{`${index + 1} из ${total}`}</span>
          <button className="icon-btn" type="button" aria-label="Следующий вариант" disabled={locked || index >= total - 1} onClick={() => variants.select(index + 1)}>
            <Icon name="right" />
          </button>
        </div>
      ) : null}
      <button
        className="icon-btn"
        type="button"
        aria-label="Другой вариант"
        aria-busy={busy || undefined}
        disabled={locked || remaining <= 0}
        onClick={variants.create}
      >
        <Icon name="refresh" />
      </button>
    </>
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
