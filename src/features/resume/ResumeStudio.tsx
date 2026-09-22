import { useMemo, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import type { CandidateMemory, ImportedSourceSummary } from '../coach/coachApi';
import { ResumeDossierRail } from './ResumeDossierRail';
import { ResumeDocumentView } from './ResumeDocumentView';
import { ResumeAtsView } from './ResumeAtsView';
import { ResumeLinkedInPackView } from './ResumeLinkedInPackView';
import { ResumeStudioHead } from './ResumeStudioHead';
import type { CandidateRegion } from '../workspace/candidateRegions';
import { buildResumeEditor } from './resumeEditor';
import {
  defaultMobilePane,
  draftOf,
  eligibleEvidence,
  previewProjection,
  selectDocument,
  summarizeResumeStudio,
} from './resumeStudioModel';
import { importedSourceOf, type ImportedSource } from './resumeSourceCoverage';
import { useResumeStudio } from './useResumeStudio';
import type {
  ResumeDraft,
  ResumeFormatMode,
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
  readonly initialFormat?: ResumeFormatMode;
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
  _regions: readonly CandidateRegion[],
  _initial: ResumeVariantId | undefined,
) {
  // Country packs were cancelled in the current owner-approved flow. Keep the
  // legacy type for stored data, but expose only the three canonical formats.
  const [chosen, setVariant] = useState<ResumeVariantId>('master');
  const variants = useMemo(() => ['master'] as const, []);
  return {
    variants,
    variant: chosen === 'master' ? chosen : 'master',
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
  const [format, setFormat] = useState<ResumeFormatMode>(props.initialFormat ?? 'stanford-pdf');
  const [pane, setPane] = useState<'dossier' | 'document'>();
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
  const activePane =
    pane ?? (defaultMobilePane(projection, variant, stale) === 'unknowns' ? 'dossier' : 'document');
  const editor = onDraftChange ? buildResumeEditor(activeDraft, onDraftChange) : undefined;
  const head = {
    variant,
    variants,
    format,
    summary,
    savedAt: view.savedAt,
    saving,
    saveError,
    unknownCount: document.unknowns.length + summary.staleEvidence,
    dossierCount: available.length,
    activePane,
    document,
    draft: activeDraft,
    onVariant: setVariant,
    onFormat: setFormat,
    onPane: setPane,
    onSave,
  };
  const paneClass = activePane === 'dossier' ? 'is-pane-dossier is-pane-unknowns' : 'is-pane-document';
  return (
    <section className={`career-resume-studio ${paneClass} is-format-${format}`}>
      <ResumeStudioHead {...head} />
      <ResumeStudioBody
        view={view}
        projection={projection}
        draft={activeDraft}
        document={document}
        format={format}
        evidence={available}
        memory={memory}
        editor={editor}
        importedSource={props.importedSource}
        documentEdited={Boolean(view.savedAt)}
      />
    </section>
  );
}

interface ResumeStudioBodyProps {
  readonly view: ResumeStudioView;
  readonly projection: ResumeStudioProjection;
  readonly draft: ResumeDraft;
  readonly document: ReturnType<typeof selectDocument>;
  readonly format: ResumeFormatMode;
  readonly evidence: readonly CandidateMemory[];
  readonly memory: readonly CandidateMemory[];
  readonly editor?: ReturnType<typeof buildResumeEditor>;
  readonly importedSource?: ImportedSource;
  readonly documentEdited: boolean;
}

function ResumeFormatMain({
  format,
  draft,
  document,
  evidence,
  editor,
}: {
  readonly format: ResumeFormatMode;
  readonly draft: ResumeDraft;
  readonly document: ReturnType<typeof selectDocument>;
  readonly evidence: readonly CandidateMemory[];
  readonly editor?: ReturnType<typeof buildResumeEditor>;
}) {
  return (
    <main className="career-resume-format-container">
      {format === 'stanford-pdf' && (
        <ResumeDocumentView
          draft={draft}
          document={document}
          evidence={evidence}
          editor={editor}
        />
      )}
      {format === 'ats-text' && (
        <ResumeAtsView document={document} draft={draft} />
      )}
      {format === 'linkedin-pack' && (
        <ResumeLinkedInPackView document={document} draft={draft} />
      )}
    </main>
  );
}

function ResumeStudioBody(props: ResumeStudioBodyProps) {
  const {
    view,
    projection,
    draft,
    document,
    format,
    evidence,
    memory,
    editor,
    importedSource,
    documentEdited,
  } = props;

  return (
    <div className="career-resume-body">
      <ResumeDossierRail
        memory={memory}
        draft={draft}
        document={document}
        freshness={view.evidenceFreshness}
        excludedEvidenceIds={projection.excludedEvidenceIds}
        importedSource={importedSource}
        documentEdited={documentEdited}
      />
      <ResumeFormatMain
        format={format}
        draft={draft}
        document={document}
        evidence={evidence}
        editor={editor}
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
