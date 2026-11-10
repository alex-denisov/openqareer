import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FileText, X } from '@phosphor-icons/react';
import type { ApprovedVacancyLetterResult } from './vacancyLetterApi';
import { loadLetterResumePreview, type LetterResumePreview } from './vacancyLetterResumePreview';

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly preview: LetterResumePreview }
  | { readonly status: 'error'; readonly message: string };

const LOAD_FAILED = 'Не удалось открыть резюме. Попробуйте ещё раз.';

function usePreview(vacancyId: string, approved: ApprovedVacancyLetterResult['resume'] | null) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadLetterResumePreview(vacancyId, approved ?? null, controller.signal)
      .then((preview) => {
        if (!controller.signal.aborted) setState({ status: 'ready', preview });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: reason instanceof Error ? reason.message : LOAD_FAILED });
      });
    return () => controller.abort();
  }, [vacancyId, approved, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}

/** Native modal dialog: focus trap and Escape come from the platform. */
function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // Focus goes back to «Открыть» when the panel closes, as with a closed native dialog.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    return () => opener?.focus();
  }, []);
  return ref;
}

function EmptyNote({ preview }: { readonly preview: LetterResumePreview }) {
  return (
    <p className="career-letter-resume-panel-note">
      {preview.kind === 'none'
        ? 'В профиле нет опыта работы: отклик уйдёт без резюме.'
        : 'К отклику приложено ваше общее резюме — файл из «Профиля».'}
    </p>
  );
}

function PanelBody({ state, onRetry }: { readonly state: LoadState; readonly onRetry: () => void }) {
  if (state.status === 'loading') {
    return (
      <p className="career-letter-resume-panel-note" role="status" aria-busy="true">
        Готовим резюме под вакансию…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="career-letter-resume-panel-error">
        <p role="alert">{state.message}</p>
        <button type="button" className="career-btn career-btn-secondary" onClick={onRetry}>
          Повторить
        </button>
      </div>
    );
  }
  if (!state.preview.text) return <EmptyNote preview={state.preview} />;
  return <pre className="career-letter-resume-panel-text">{state.preview.text}</pre>;
}

function PanelFooter({
  onClose,
  onOpenProfile,
}: {
  readonly onClose: () => void;
  readonly onOpenProfile?: () => void;
}) {
  return (
    <footer className="career-letter-resume-panel-foot">
      <button type="button" className="career-btn career-btn-primary" onClick={onClose}>
        Вернуться к письму
      </button>
      {onOpenProfile ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onOpenProfile}>
          Открыть «Профиль»
        </button>
      ) : null}
    </footer>
  );
}

/**
 * B631: «Резюме под вакансию → Открыть» shows the resume that goes with this response in a panel
 * over the letter. The letter stays where it was; the profile is one optional step away.
 */
export function VacancyLetterResumePanel({
  vacancyId,
  approved,
  onClose,
  onOpenProfile,
}: {
  readonly vacancyId: string;
  readonly approved: ApprovedVacancyLetterResult['resume'] | null;
  readonly onClose: () => void;
  readonly onOpenProfile?: () => void;
}) {
  const ref = useModalDialog();
  const titleId = useId();
  const { state, retry } = usePreview(vacancyId, approved);
  const title = state.status === 'ready' ? state.preview.title : 'Резюме под вакансию';
  return (
    <dialog
      ref={ref}
      className="career-letter-resume-panel"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <header className="career-letter-resume-panel-head">
        <FileText size={18} aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="career-letter-resume-panel-x"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="career-letter-resume-panel-body">
        <PanelBody state={state} onRetry={retry} />
      </div>
      <PanelFooter onClose={onClose} onOpenProfile={onOpenProfile} />
    </dialog>
  );
}
