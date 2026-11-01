import type { ProfileItemSection } from '../../../shared/profileItemRevision';
import {
  InlineConsultantSuggestion,
  type InlineSuggestionItem,
} from './InlineConsultantSuggestion';

export interface ProfileItemSuggestionsProps {
  readonly sections: readonly ProfileItemSection[];
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
}

/** Consultant proposals for a list section, shown inside that section (01.11). */
export function ProfileItemSuggestions({
  sections,
  suggestions,
  onAcceptSuggestion,
  onDismissSuggestion,
  onRevertSuggestion,
}: ProfileItemSuggestionsProps) {
  const items = (suggestions ?? []).filter((suggestion) =>
    (sections as readonly string[]).includes(suggestion.section),
  );
  if (!items.length) return null;
  return (
    <div className="career-profile-item-suggestions">
      {items.map((suggestion) => (
        <InlineConsultantSuggestion
          key={suggestion.id}
          suggestion={suggestion}
          onAccept={onAcceptSuggestion}
          onDismiss={onDismissSuggestion}
          onRevert={onRevertSuggestion}
        />
      ))}
    </div>
  );
}
