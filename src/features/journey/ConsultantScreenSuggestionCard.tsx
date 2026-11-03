import '../today/today-decision-proposal.css';
import { Check, X } from '@phosphor-icons/react';
import type { ConsultantScreenSuggestion } from './consultantScreenSuggestion';

/** Макеты 5 и 9: предложение по экрану с двумя действиями, как прочие предложения панели. */
export function ConsultantScreenSuggestionCard({
  suggestion,
  onDismiss,
}: {
  readonly suggestion: ConsultantScreenSuggestion;
  readonly onDismiss: (id: string) => void;
}) {
  return (
    <section className="career-expert-proposal" aria-label={suggestion.title}>
      <p className="career-expert-proposal-title">{suggestion.title}</p>
      <p>{suggestion.detail}</p>
      <div className="career-expert-actions">
        <button
          type="button"
          className="career-quiet-button career-inline-ok"
          onClick={() => {
            suggestion.onAccept();
            onDismiss(suggestion.id);
          }}
        >
          <Check size={16} aria-hidden="true" />
          {suggestion.acceptLabel}
        </button>
        <button
          type="button"
          className="career-quiet-button"
          onClick={() => onDismiss(suggestion.id)}
        >
          <X size={16} aria-hidden="true" />
          {suggestion.dismissLabel}
        </button>
      </div>
    </section>
  );
}
