import type { ReactElement } from 'react';
import { ArrowsClockwise, ChatCircleText, CircleNotch, Info, WarningCircle } from '@phosphor-icons/react';

import { EMPTY_SOURCES_TEXT, SESSION_ERROR_TEXT } from './firstRunSpecialState';

/** Спиннер и подпись, называющая субъект и шаг. */
export function FirstRunStaleLoading({ label }: { readonly label: string }): ReactElement {
  return (
    <div className="first-run-state-status" role="status" data-testid="first-run-stale-loading">
      <CircleNotch size={20} className="career-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function FirstRunErrorState({ onRetry }: { readonly onRetry: () => void }): ReactElement {
  return (
    <div className="first-run-state-block" data-testid="first-run-error-state">
      <div className="first-run-state-message is-error" role="alert">
        <WarningCircle size={20} aria-hidden="true" />
        <span>{SESSION_ERROR_TEXT}</span>
      </div>
      <button
        type="button"
        className="first-run-btn-ghost"
        onClick={onRetry}
        data-testid="error-retry-btn"
      >
        <ArrowsClockwise size={16} aria-hidden="true" />
        Повторить
      </button>
    </div>
  );
}

export function FirstRunEmptySources({
  onConsultant,
}: {
  readonly onConsultant: () => void;
}): ReactElement {
  return (
    <div className="first-run-empty-sources" data-testid="first-run-empty-sources">
      <p className="first-run-goal-text">{EMPTY_SOURCES_TEXT}</p>
      <button
        type="button"
        className="first-run-btn-ghost"
        onClick={onConsultant}
        data-testid="empty-consultant-btn"
      >
        <ChatCircleText size={16} aria-hidden="true" />
        Рассказать консультанту
      </button>
    </div>
  );
}

export function FirstRunPartialSources({ message }: { readonly message: string }): ReactElement {
  return (
    <div className="first-run-state-message" role="status" data-testid="first-run-partial-sources">
      <Info size={20} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
