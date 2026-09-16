import { useMemo, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import type { CandidateMemory, ImportedSourceSummary } from '../coach/coachApi';
import { ResumeControlRail } from './ResumeControlRail';
import { ResumeDocumentView } from './ResumeDocumentView';
import { ResumeStudioHead } from './ResumeStudioHead';
import type { CandidateRegion } from '../workspace/candidateRegions';
import { buildResumeEditor } from './resumeEditor';
import {
  defaultMobilePane,
  draftOf,
  eligibleEvidence,
  previewProjection,
  resumeVariantsFor,
  selectDocument,
  summarizeResumeStudio,
} from './resumeStudioModel';
import { importedSourceOf, type ImportedSource } from './resumeSourceCoverage';
import { useResumeStudio } from './useResumeStudio';
import type {
  ResumeDraft,
  ResumeStudioProjection,
  ResumeStudioView,
  ResumeVariantId,
} from './resumeTypes';

interface ResumeStudioProps {
  readonly memory: readonly CandidateMemory[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  readonly regions: readonly CandidateRegion[];
  readonly onRefreshFacts?: () => void;
}

/** Connects the candidate-scoped resume API to the surface. */
export function ResumeStudio({
  memory,
  regions,
  importedSources,
  onRefreshFacts,
}: ResumeStudioProps) {
  const state = useResumeStudio(onRefreshFacts);
  return (
    <ResumeStudioSurface
      importedSource={importedSourceOf(importedSources)}
      view={state.view}
      draft={state.draft}
      memory={memory}
      regions={regions}
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
  readonly regions?: readonly CandidateRegion[];
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly error?: string;
  readonly saveError?: string;
  readonly initialVariant?: ResumeVariantId;
  readonly importedSource?: ImportedSource;
  readonly onRetry?: () => void;
  readonly onDraftChange?: (draft: ResumeDraft) => void;
  readonly onSave?: () => void;
}

/**
 * The offered variants follow the regions the candidate chose, so a variant
 * that is no longer offered falls back to the master document instead of
 * rendering a country pack nobody asked for (B158).
 */
function useResumeVariant(
  regions: readonly CandidateRegion[],
  initial: ResumeVariantId | undefined,
) {
  const [chosen, setVariant] = useState<ResumeVariantId>(initial ?? 'master');
  const variants = useMemo(() => resumeVariantsFor(regions), [regions]);
  return {
    variants,
    variant: variants.includes(chosen) ? chosen : 'master',
    setVariant,
  };
}

/**
 * Presentational surface, separated so every state can be asserted without a
 * network. Editing turns on only when a draft owner supplies `onDraftChange`.
 */
// eslint-disable-next-line max-lines-per-function
export function ResumeStudioSurface(props: ResumeStudioSurfaceProps) {
  const { view, draft, memory = [], regions = [], error, onRetry, onDraftChange } = props;
  const { loading = false, saving = false, saveError, onSave } = props;
  const { variant, variants, setVariant } = useResumeVariant(regions, props.initialVariant);
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
    variants,
    summary,
    savedAt: view.savedAt,
    saving,
    saveError,
    unknownCount: document.unknowns.length + summary.staleEvidence,
    activePane,
    document,
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
        memory={memory}
        editor={editor}
        importedSource={props.importedSource}
        documentEdited={Boolean(view.savedAt)}
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
  memory,
  editor,
  importedSource,
  documentEdited,
}: {
  view: ResumeStudioView;
  projection: ResumeStudioProjection;
  draft: ResumeDraft;
  document: ReturnType<typeof selectDocument>;
  evidence: readonly CandidateMemory[];
  memory: readonly CandidateMemory[];
  editor?: ReturnType<typeof buildResumeEditor>;
  importedSource?: ImportedSource;
  documentEdited: boolean;
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
        draft={draft}
        memory={memory}
        importedSource={importedSource}
        documentEdited={documentEdited}
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
