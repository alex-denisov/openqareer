import { useEffect, useRef } from 'react';
import { CheckCircle, CircleNotch, WarningCircle, X } from '@phosphor-icons/react';
import {
  dismissLinkedInBackgroundImport,
  showLinkedInImportWindow,
  useLinkedInBackgroundImport,
  type LinkedInBackgroundState,
} from './linkedinBackgroundImport';
import { linkedinImportProgressView, useLinkedInImportProgress } from './linkedinImportProgress';
import './linkedinImportStatus.css';

const DONE_VISIBLE_MS = 6_000;

/**
 * The out-of-sight LinkedIn import reports here, whatever screen is open:
 * that it runs, that LinkedIn asks for a person, and how it ended (owner,
 * 30.10). The section walk itself is drawn on the profile band.
 */
export function LinkedInImportStatus({ onSaved }: { readonly onSaved?: () => void }) {
  const state = useLinkedInBackgroundImport();
  const progress = linkedinImportProgressView(useLinkedInImportProgress());
  const reported = useRef<LinkedInBackgroundState>();
  useEffect(() => {
    if (state.phase !== 'done' || reported.current === state) return undefined;
    reported.current = state;
    onSaved?.();
    const timer = window.setTimeout(dismissLinkedInBackgroundImport, DONE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [state, onSaved]);
  switch (state.phase) {
    case 'idle':
      return null;
    case 'needs_person':
      return <NeedsPersonNote message={state.message} />;
    case 'done':
    case 'failed':
      return <OutcomeNote failed={state.phase === 'failed'} message={state.message} />;
    default:
      return (
        <div className="linkedin-import-status career-token-scope" role="status">
          <CircleNotch size={16} className="linkedin-import-status-spinner" aria-hidden="true" />
          <span>{runningText(state.phase, progress)}</span>
        </div>
      );
  }
}

function NeedsPersonNote({ message }: { readonly message: string }) {
  return (
    <div className="linkedin-import-status career-token-scope" role="status">
      <WarningCircle size={16} aria-hidden="true" />
      <span>{message}</span>
      <button
        type="button"
        className="career-quiet-button career-btn-sm"
        onClick={() => void showLinkedInImportWindow()}
      >
        Показать окно
      </button>
    </div>
  );
}

function OutcomeNote({ failed, message }: { readonly failed: boolean; readonly message: string }) {
  return (
    <div
      className={`linkedin-import-status career-token-scope${failed ? ' is-failed' : ''}`}
      role={failed ? 'alert' : 'status'}
    >
      {failed ? (
        <WarningCircle size={16} aria-hidden="true" />
      ) : (
        <CheckCircle size={16} aria-hidden="true" />
      )}
      <span>{message}</span>
      <button
        type="button"
        className="linkedin-import-status-close"
        aria-label="Закрыть"
        onClick={dismissLinkedInBackgroundImport}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function runningText(
  phase: 'opening' | 'reading' | 'saving',
  progress: ReturnType<typeof linkedinImportProgressView>,
): string {
  if (phase === 'saving') return 'LinkedIn: сохраняем профиль…';
  if (phase === 'reading' && progress) {
    return `LinkedIn: читаем разделы в фоне, ${progress.readCount} из ${progress.total}`;
  }
  return phase === 'reading' ? 'LinkedIn: читаем профиль в фоне…' : 'LinkedIn: импорт идёт в фоне…';
}
