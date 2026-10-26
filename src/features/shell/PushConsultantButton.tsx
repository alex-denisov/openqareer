import { createContext, useContext } from 'react';
import { Sparkle } from '@phosphor-icons/react';

/** The shell's «open the consultant» for 390 push screens that cover its top bar. */
export const PushConsultantContext = createContext<(() => void) | null>(null);

/** Right slot of a 390 push bar (mockups 13 and 15): the same consultant button as the top bar. */
export function PushConsultantButton() {
  const open = useContext(PushConsultantContext);
  if (!open) return null;
  return (
    <button
      type="button"
      className="vacancy-push-consultant"
      aria-label="Консультант: открыть"
      onClick={open}
    >
      <Sparkle size={18} aria-hidden="true" />
    </button>
  );
}
