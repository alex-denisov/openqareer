import { useMemo, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import { ResumeControlRail } from './ResumeControlRail';
import { ResumeDocumentView } from './ResumeDocumentView';
import { ResumeStudioHead } from './ResumeStudioHead';
import { buildResumeEditor } from './resumeEditor';
import {
  defaultMobilePane,
  draftOf,
  eligibleEvidence,
  previewProjection,
  selectDocument,
  summarizeResumeStudio,
} from './resumeStudioModel';
import { useResumeStudio } from './useResumeStudio';
import type {
  ResumeDraft,
  ResumeStudioProjection,
  ResumeStudioView,
  ResumeVariantId,
} from './resumeTypes';

interface ResumeStudioProps {
  readonly memory: readonly CandidateMemory[];
  readonly onRefreshDossier?: () => void;
}

/** Connects the candidate-scoped resume API to the surface. */
export function ResumeStudio({ memory, onRefreshDossier }: ResumeStudioProps) {
  const state = useResumeStudio(onRefreshDossier);
  return (
    <ResumeStudioSurface
      view={state.view}
      draft={state.draft}
      memory={memory}
      loading={state.loading}
      saving={state.saving}
      error={state.error}
      saveError={state.saveError}
      onRetry={state.reload}
      onDraftChange={state.setDraft}
      onSave={state.save}
    />
  );
}

interface ResumeStudioSurfaceProps {
  readonly view?: ResumeStudioView;
  readonly draft?: ResumeDraft;
  readonly memory?: readonly CandidateMemory[];
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly error?: string;
  readonly saveError?: string;
  readonly initialVariant?: ResumeVariantId;
  readonly onRetry?: () => void;
  readonly onDraftChange?: (draft: ResumeDraft) => void;
  readonly onSave?: () => void;
}

/**
 * Presentational surface, separated so every state can be asserted without a
 * network. Editing turns on only when a draft owner supplies `onDraftChange`.
 */
export function ResumeStudioSurface(props: ResumeStudioSurfaceProps) {
  const { view, draft, memory = [], error, onRetry, onDraftChange } = props;
  const { loading = false, saving = false, saveError, onSave } = props;
  const [variant, setVariant] = useState<ResumeVariantId>(
    props.initialVariant ?? 'master',
  );
  const [pane, setPane] = useState<'unknowns' | 'document'>();
  const available = useMemo(() => eligibleEvidence(memory), [memory]);
  const activeDraft = draft ?? (view ? draftOf(view) : undefined);
  // Both documents are rebuilt from the draft in hand, so an unknown closes the
  // moment the candidate fills it instead of waiting for the next save.
  const projection = useMemo(
    () => (activeDraft ? previewProjection(activeDraft, memory) : undefined),
    [activeDraft, memory],
  );

  if (loading) return <ResumeStudioLoading />;
  if (error || !view || !activeDraft || !projection) {
    return <ResumeStudioFailure message={error} onRetry={onRetry} />;
  }

  const stale = view.evidenceFreshness.stale.length;
  const document = selectDocument(projection, variant);
  const summary = summarizeResumeStudio(projection, variant, stale);
  const activePane = pane ?? defaultMobilePane(projection, variant, stale);
  const editor = onDraftChange ? buildResumeEditor(activeDraft, onDraftChange) : undefined;
  const head = {
    variant,
    summary,
    savedAt: view.savedAt,
    saving,
    saveError,
    unknownCount: document.unknowns.length + summary.staleEvidence,
    activePane,
    onVariant: setVariant,
    onPane: setPane,
    onSave,
  };
  return (
    <section className={`career-resume-studio is-pane-${activePane}`}>
      <ResumeStudioHead {...head} />
      <ResumeStudioBody
        view={view}
        projection={projection}
        draft={activeDraft}
        document={document}
        evidence={available}
        editor={editor}
      />
    </section>
  );
}


function ResumeStudioBody({
  view,
  projection,
  draft,
  document,
  evidence,
  editor,
}: {
  view: ResumeStudioView;
  projection: ResumeStudioProjection;
  draft: ResumeDraft;
  document: ReturnType<typeof selectDocument>;
  evidence: readonly CandidateMemory[];
  editor?: ReturnType<typeof buildResumeEditor>;
}) {
  return (
    <div className="career-resume-body">
      <ResumeDocumentView
        draft={draft}
        document={document}
        evidence={evidence}
        editor={editor}
      />
      <ResumeControlRail
        freshness={view.evidenceFreshness}
        excludedEvidenceIds={projection.excludedEvidenceIds}
        document={document}
      />
    </div>
  );
}

function ResumeStudioLoading() {
  return (
    <section className="career-resume-studio is-state" aria-busy="true" aria-live="polite">
      <p className="career-cabinet-kicker">Резюме</p>
      <p>Загружаем резюме и подтверждённые доказательства…</p>
    </section>
  );
}

function ResumeStudioFailure({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="career-resume-studio is-state">
      <p className="career-cabinet-kicker">Резюме</p>
      <p role="alert">{message ?? 'Резюме недоступно.'}</p>
      {onRetry ? (
        <button className="career-quiet-button" type="button" onClick={onRetry}>
          <ArrowClockwise size={16} /> Повторить
        </button>
      ) : null}
    </section>
  );
}
