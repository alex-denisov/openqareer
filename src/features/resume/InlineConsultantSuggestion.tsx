import { useState } from 'react';
import { Spinner } from '@phosphor-icons/react';

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
      {currentText !== undefined ? (
        <div className="career-consultant-suggestion-col is-current">
          <span className="career-consultant-suggestion-col-label">Сейчас</span>
          <p className="career-consultant-suggestion-text">
            {currentText || 'Раздел пока пуст.'}
          </p>
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
          aria-busy={busy || undefined}
        >
          {busy ? <Spinner size={16} aria-hidden="true" /> : null}
          {busy ? 'Откатываем…' : 'Откатить'}
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
        aria-busy={busy || loading || undefined}
      >
        {busy ? <Spinner size={16} aria-hidden="true" /> : null}
        {busy ? 'Применяем…' : 'Принять'}
      </button>
      <button
        type="button"
        className="career-quiet-button"
        onClick={onDismiss}
        disabled={busy || loading}
        aria-busy={busy || loading || undefined}
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
  const [error, setError] = useState<string>();

  const handleAccept = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onAccept(suggestion);
      setApplied(true);
    } catch (reason) {
      setError(actionErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = async () => {
    if (!onRevert) return;
    setBusy(true);
    setError(undefined);
    try {
      await onRevert(suggestion);
      setApplied(false);
    } catch (reason) {
      setError(actionErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return { busy, applied, error, handleAccept, handleRevert };
}

function actionErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return 'Не удалось сохранить правку профиля. Повторите попытку.';
}

export function InlineConsultantSuggestion({
  suggestion,
  onAccept,
  onDismiss,
  onRevert,
  loading,
}: InlineConsultantSuggestionProps) {
  const { busy, applied, error, handleAccept, handleRevert } = useSuggestionActionState(
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
      aria-busy={busy || loading || undefined}
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
      {error ? (
        <p className="career-command-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
