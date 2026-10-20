import { useCallback, useEffect, useRef, useState } from 'react';
import { useProfileEntrySave, type ProfileEntrySaveResult } from './profileEntrySave';
import { CaretDown, PencilSimple, Sparkle } from '@phosphor-icons/react';
import { parseAboutContent } from './profileAbout';
import { updateAbout } from './profileEntryEditing';
import { SectionEditActions } from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import { ProfileProvenanceChip, useProfileProvenance } from './ProfileProvenanceChip';
import { aboutProvenance } from './profileProvenance';
import {
  InlineConsultantSuggestion,
  type InlineSuggestionItem,
} from './InlineConsultantSuggestion';
import type { ResumeDraft } from './resumeTypes';

export interface ProfileAboutSectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onSuggestWithConsultant?: () => void;
  readonly detailView?: boolean;
}

function AboutEditForm({
  draft,
  saving,
  onCancel,
  onSectionSave,
}: ProfileAboutSectionProps & { readonly onCancel: () => void }) {
  const submit = useProfileEntrySave(onSectionSave, () => undefined);
  const [about, setAbout] = useState(draft.candidate.about ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <textarea
        id="about-edit-input"
        data-testid="about-edit-textarea"
        className="career-profile-screen-textarea"
        rows={8}
        value={about}
        onChange={(event) => setAbout(event.target.value)}
        placeholder={'Абзацы через пустую строку, буллеты — с "-" в начале строки'}
      />
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <SectionEditActions
        saving={saving || submit.busy}
        onCancel={onCancel}
        onSave={() => {
          void submit.save(updateAbout(draft, about));
        }}
      />
    </div>
  );
}

function useClampedAbout(about: string, detailView: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || detailView) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const line = Number.parseFloat(getComputedStyle(element).lineHeight);
      setCanExpand(Number.isFinite(line) && element.scrollHeight > line * 3 + 1);
    };
    measure();
    void document.fonts?.ready.then(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [about, detailView]);
  return { ref, canExpand };
}

/** Keep the full source in the DOM; the approved excerpt clamps rendered lines. */
function AboutContent({
  about,
  detailView = false,
}: {
  readonly about: string;
  readonly detailView?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { ref, canExpand } = useClampedAbout(about, detailView);
  const blocks = parseAboutContent(about);
  return (
    <div className="career-profile-screen-about-content">
      <div
        ref={ref}
        className={`profile-about-text ${expanded || detailView ? 'is-open' : 'is-clamped'}`}
      >
        {blocks.map((block, index) =>
          block.type === 'paragraph' ? (
            <p key={index}>{block.text}</p>
          ) : (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          ),
        )}
      </div>
      {canExpand && !detailView ? (
        <button
          type="button"
          className="career-quiet-button career-btn-sm profile-about-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <CaretDown size="1em" aria-hidden="true" />
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      ) : null}
    </div>
  );
}

/** Puts back the text the consultant edit replaced; its origin is matched again (B541). */
function revertAbout(
  draft: ResumeDraft,
  suggestion: { readonly proposedText: string; readonly currentText?: string },
  onSectionSave: ProfileAboutSectionProps['onSectionSave'],
): (() => Promise<void>) | undefined {
  if (suggestion.currentText === undefined) return undefined;
  return async () => {
    if (draft.candidate.about !== suggestion.proposedText)
      throw new Error('Текст уже изменился. Обновите профиль перед откатом.');
    if (
      (await onSectionSave(updateAbout(draft, suggestion.currentText ?? '', 'restore'))) === false
    )
      throw new Error('Не удалось откатить правку. Повторите попытку.');
  };
}

function AboutSuggestionsList({
  draft,
  suggestions,
  onSectionSave,
  onAcceptSuggestion,
  onDismissSuggestion,
  onRevertSuggestion,
}: Pick<
  ProfileAboutSectionProps,
  | 'draft'
  | 'suggestions'
  | 'onSectionSave'
  | 'onAcceptSuggestion'
  | 'onDismissSuggestion'
  | 'onRevertSuggestion'
>) {
  const aboutSuggestions = (suggestions ?? []).filter((s) => s.section === 'about');
  return (
    <>
      {aboutSuggestions.map((suggestion) => (
        <InlineConsultantSuggestion
          key={suggestion.id}
          suggestion={suggestion}
          onAccept={
            onAcceptSuggestion ??
            (async (s) => {
              if ((await onSectionSave(updateAbout(draft, s.proposedText, 'consultant'))) === false)
                throw new Error('Не удалось сохранить правку. Повторите попытку.');
            })
          }
          onDismiss={onDismissSuggestion}
          onRevert={onRevertSuggestion ?? revertAbout(draft, suggestion, onSectionSave)}
        />
      ))}
    </>
  );
}

function AboutViewBody({
  editing,
  about,
  draft,
  saving,
  detailView,
  onSectionSave,
  onCancel,
}: {
  readonly editing: boolean;
  readonly about?: string;
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly detailView?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => ProfileEntrySaveResult;
  readonly onCancel: () => void;
}) {
  if (editing) {
    return (
      <AboutEditForm
        draft={draft}
        saving={saving}
        onSectionSave={onSectionSave}
        onCancel={onCancel}
      />
    );
  }
  if (about) {
    return <AboutContent about={about} detailView={detailView} />;
  }
  return <p className="career-profile-screen-empty-note">Раздел «Обо мне» ещё не заполнен.</p>;
}

function AboutActionButtons({
  onEdit,
  onSuggest,
}: {
  readonly onEdit: () => void;
  readonly onSuggest?: () => void;
}) {
  return (
    <div className="career-profile-about-actions">
      <button
        type="button"
        className="career-quiet-button"
        onClick={onEdit}
        data-testid="about-edit-text-btn"
      >
        <PencilSimple size={16} aria-hidden="true" />
        Изменить текст
      </button>
      {onSuggest ? (
        <button
          type="button"
          className="career-quiet-button"
          onClick={onSuggest}
          data-testid="about-consultant-suggest-btn"
        >
          <Sparkle size={16} aria-hidden="true" />
          Предложить вариант с консультантом
        </button>
      ) : null}
    </div>
  );
}

function useProfileAboutSuggestions({
  suggestions,
  onSuggestWithConsultant,
}: {
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onSuggestWithConsultant?: () => void;
}) {
  return {
    allSuggestions: suggestions ?? [],
    handleSuggest: onSuggestWithConsultant,
  };
}

function useProfileAboutHandlers({
  draft,
  onSectionSave,
  onAcceptSuggestion,
  onDismissSuggestion,
}: {
  readonly draft: ResumeDraft;
  readonly onSectionSave: (draft: ResumeDraft) => ProfileEntrySaveResult;
  readonly onAcceptSuggestion?: (s: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (s: InlineSuggestionItem) => void;
}) {
  const handleAccept = useCallback(
    async (s: InlineSuggestionItem) => {
      if (onAcceptSuggestion) await onAcceptSuggestion(s);
      else if ((await onSectionSave(updateAbout(draft, s.proposedText))) === false)
        throw new Error('Не удалось сохранить правку. Повторите попытку.');
    },
    [draft, onSectionSave, onAcceptSuggestion],
  );

  const handleDismiss = useCallback(
    (s: InlineSuggestionItem) => {
      return onDismissSuggestion?.(s);
    },
    [onDismissSuggestion],
  );

  return { handleAccept, handleDismiss: onDismissSuggestion ? handleDismiss : undefined };
}

function useProfileAboutView(props: ProfileAboutSectionProps) {
  const { draft, onSectionSave, suggestions } = props;
  const [editing, setEditing] = useState(false);
  const about = draft.candidate.about?.trim();
  const { allSuggestions, handleSuggest } = useProfileAboutSuggestions({
    suggestions,
    onSuggestWithConsultant: props.onSuggestWithConsultant,
  });
  const { handleAccept, handleDismiss } = useProfileAboutHandlers({
    draft,
    onSectionSave,
    onAcceptSuggestion: props.onAcceptSuggestion,
    onDismissSuggestion: props.onDismissSuggestion,
  });
  return { editing, setEditing, about, allSuggestions, handleSuggest, handleAccept, handleDismiss };
}

function AboutSectionHead({
  about,
  candidate,
  onEdit,
}: {
  readonly about?: string;
  readonly candidate: ResumeDraft['candidate'];
  readonly onEdit: () => void;
}) {
  const { memory } = useProfileProvenance();
  return (
    <SectionHead
      id="sec-about-title"
      title="Обо мне"
      action={
        <button
          type="button"
          className="profile-about-source-control"
          aria-label="Изменить «Обо мне»"
          onClick={onEdit}
        >
          {about ? (
            <ProfileProvenanceChip provenance={aboutProvenance(candidate, memory)} />
          ) : (
            <>
              <PencilSimple size="1em" aria-hidden="true" />
              Добавить текст
            </>
          )}
        </button>
      }
    />
  );
}

export function ProfileAboutSection(props: ProfileAboutSectionProps) {
  const { draft, saving, onSectionSave, onRevertSuggestion } = props;
  const { editing, setEditing, about, allSuggestions, handleSuggest, handleAccept, handleDismiss } =
    useProfileAboutView(props);

  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section"
      id="sec-about"
      aria-labelledby="sec-about-title"
    >
      <AboutSectionHead about={about} candidate={draft.candidate} onEdit={() => setEditing(true)} />
      <AboutViewBody
        editing={editing}
        about={about}
        draft={draft}
        saving={saving}
        detailView={props.detailView}
        onSectionSave={async (next) => {
          const result = await onSectionSave(next);
          if (result !== false) setEditing(false);
          return result;
        }}
        onCancel={() => setEditing(false)}
      />
      {!editing && props.detailView ? (
        <AboutActionButtons onEdit={() => setEditing(true)} onSuggest={handleSuggest} />
      ) : null}
      <AboutSuggestionsList
        draft={draft}
        suggestions={allSuggestions}
        onSectionSave={onSectionSave}
        onAcceptSuggestion={handleAccept}
        onDismissSuggestion={handleDismiss}
        onRevertSuggestion={onRevertSuggestion}
      />
    </section>
  );
}
