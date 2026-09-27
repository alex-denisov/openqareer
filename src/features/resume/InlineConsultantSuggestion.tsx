import { useState } from 'react';

export interface InlineSuggestionItem {
  readonly id: string;
  readonly section: 'headline' | 'about' | 'experience';
  readonly experienceId?: string;
  readonly title?: string;
  readonly rationale?: string;
  readonly currentText?: string;
  readonly proposedText: string;
  readonly commandId?: string;
  readonly turnIdempotencyKey?: string;
  readonly proposalIndex?: number;
  readonly applied?: boolean;
}

export interface InlineConsultantSuggestionProps {
  readonly suggestion: InlineSuggestionItem;
  readonly onAccept: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismiss: (suggestion: InlineSuggestionItem) => void;
  readonly onRevert?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly loading?: boolean;
}

function SuggestionComparison({
  currentText,
  proposedText,
}: {
  readonly currentText?: string;
  readonly proposedText: string;
}) {
  return (
    <div className="career-consultant-suggestion-comparison">
      {currentText ? (
        <div className="career-consultant-suggestion-col is-current">
          <span className="career-consultant-suggestion-col-label">Сейчас</span>
          <p className="career-consultant-suggestion-text">{currentText}</p>
        </div>
      ) : null}
      <div className="career-consultant-suggestion-col is-proposed">
        <span className="career-consultant-suggestion-col-label">Станет</span>
        <p className="career-consultant-suggestion-text">{proposedText}</p>
      </div>
    </div>
  );
}

function AppliedActions({
  busy,
  onRevert,
}: {
  readonly busy: boolean;
  readonly onRevert?: () => void;
}) {
  return (
    <div className="career-consultant-suggestion-actions">
      <span className="career-consultant-suggestion-status">Правка применена</span>
      {onRevert ? (
        <button
          type="button"
          className="career-quiet-button"
          onClick={onRevert}
          disabled={busy}
        >
          Откатить
        </button>
      ) : null}
    </div>
  );
}

function PendingActions({
  busy,
  loading,
  onAccept,
  onDismiss,
}: {
  readonly busy: boolean;
  readonly loading?: boolean;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="career-consultant-suggestion-actions">
      <button
        type="button"
        className="career-primary-button"
        onClick={onAccept}
        disabled={busy || loading}
      >
        Принять
      </button>
      <button
        type="button"
        className="career-quiet-button"
        onClick={onDismiss}
        disabled={busy || loading}
      >
        Отклонить
      </button>
    </div>
  );
}

function SuggestionHead({
  title,
  rationale,
}: {
  readonly title?: string;
  readonly rationale?: string;
}) {
  return (
    <div className="career-consultant-suggestion-head">
      <span className="career-consultant-suggestion-title">
        {title ?? 'Предложение карьерного консультанта'}
      </span>
      {rationale ? (
        <span className="career-consultant-suggestion-rationale">
          {rationale}
        </span>
      ) : null}
    </div>
  );
}

function useSuggestionActionState(
  suggestion: InlineSuggestionItem,
  onAccept: (suggestion: InlineSuggestionItem) => Promise<void> | void,
  onRevert?: (suggestion: InlineSuggestionItem) => Promise<void> | void,
) {
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(Boolean(suggestion.applied));

  const handleAccept = async () => {
    setBusy(true);
    try {
      await onAccept(suggestion);
      setApplied(true);
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = async () => {
    if (!onRevert) return;
    setBusy(true);
    try {
      await onRevert(suggestion);
      setApplied(false);
    } finally {
      setBusy(false);
    }
  };

  return { busy, applied, handleAccept, handleRevert };
}

export function InlineConsultantSuggestion({
  suggestion,
  onAccept,
  onDismiss,
  onRevert,
  loading,
}: InlineConsultantSuggestionProps) {
  const { busy, applied, handleAccept, handleRevert } = useSuggestionActionState(
    suggestion,
    onAccept,
    onRevert,
  );

  return (
    <div
      className="career-consultant-suggestion"
      data-testid={`consultant-suggestion-${suggestion.id}`}
      role="region"
      aria-label="Предложение карьерного консультанта"
    >
      <SuggestionHead title={suggestion.title} rationale={suggestion.rationale} />
      <SuggestionComparison
        currentText={suggestion.currentText}
        proposedText={suggestion.proposedText}
      />
      {applied ? (
        <AppliedActions busy={busy} onRevert={onRevert ? handleRevert : undefined} />
      ) : (
        <PendingActions
          busy={busy}
          loading={loading}
          onAccept={handleAccept}
          onDismiss={() => onDismiss(suggestion)}
        />
      )}
    </div>
  );
}
