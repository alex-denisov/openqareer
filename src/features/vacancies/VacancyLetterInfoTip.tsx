import { Info } from '@phosphor-icons/react';
import { CareerTooltip } from '../shell/CareerTooltip';

/** The (i) button of the mockup: the explanation opens on hover, focus and tap. */
export function LetterInfoTip({ text }: { readonly text: string }) {
  return (
    <CareerTooltip content={text} side="bottom">
      <button type="button" className="career-btn is-sm is-icon is-ghost career-letter-info-tip" aria-label="Пояснение">
        <Info size={16} aria-hidden="true" />
      </button>
    </CareerTooltip>
  );
}
