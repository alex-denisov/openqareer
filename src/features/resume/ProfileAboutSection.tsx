import { useCallback, useState } from 'react';
import { PencilSimple, Sparkle } from '@phosphor-icons/react';
import { parseAboutContent } from './profileAbout';
import { updateAbout } from './profileEntryEditing';
import { SectionEditActions, SectionPencilButton } from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import {
  InlineConsultantSuggestion,
  type InlineSuggestionItem,
} from './InlineConsultantSuggestion';
import type { ResumeDraft } from './resumeTypes';

export interface ProfileAboutSectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onSuggestWithConsultant?: () => void;
}

function AboutEditForm({
  draft,
  saving,
  onCancel,
  onSectionSave,
}: ProfileAboutSectionProps & { readonly onCancel: () => void }) {
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
      <SectionEditActions
        saving={saving}
        onCancel={onCancel}
        onSave={() => onSectionSave(updateAbout(draft, about))}
      />
    </div>
  );
}

/** Renders paragraphs and bullet lists separately (B265 owner remark #6). */
function AboutContent({ about }: { readonly about: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = about.split(/\r?\n/u);
  const truncated = lines.length > 3;
  const shownAbout = truncated && !expanded ? lines.slice(0, 3).join('\n') : about;
  const blocks = parseAboutContent(shownAbout);
  return (
    <div className="career-profile-screen-about-content">
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
      {truncated ? (
        <button
          type="button"
          className="career-quiet-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Свернуть' : 'Показать полностью'}
        </button>
      ) : null}
    </div>
  );
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
            onAcceptSuggestion ?? ((s) => onSectionSave(updateAbout(draft, s.proposedText)))
          }
          onDismiss={onDismissSuggestion ?? (() => {})}
          onRevert={
            onRevertSuggestion ??
            (suggestion.currentText !== undefined
              ? () => onSectionSave(updateAbout(draft, suggestion.currentText ?? ''))
              : undefined)
          }
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
  onSectionSave,
  onCancel,
}: {
  readonly editing: boolean;
  readonly about?: string;
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
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
    return <AboutContent about={about} />;
  }
  return <p className="career-profile-screen-empty-note">Раздел «Обо мне» ещё не заполнен.</p>;
}

function AboutActionButtons({
  onEdit,
  onSuggest,
}: {
  readonly onEdit: () => void;
  readonly onSuggest: () => void;
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
      <button
        type="button"
        className="career-quiet-button"
        onClick={onSuggest}
        data-testid="about-consultant-suggest-btn"
      >
        <Sparkle size={16} aria-hidden="true" />
        Предложить вариант с консультантом
      </button>
    </div>
  );
}

function useProfileAboutSuggestions({
  about,
  suggestions,
  onSuggestWithConsultant,
}: {
  readonly about?: string;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onSuggestWithConsultant?: () => void;
}) {
  const [localSuggestions, setLocalSuggestions] = useState<readonly InlineSuggestionItem[]>([]);
  const handleSuggest = () => {
    if (onSuggestWithConsultant) {
      onSuggestWithConsultant();
      return;
    }
    const suggestion: InlineSuggestionItem = {
      id: `about-sugg-${Date.now()}`,
      section: 'about',
      currentText: about ?? '',
      proposedText: `${about ? `${about}\n` : ''}Руковожу инженерией продуктовых платформ, развиваю распределенные команды и масштабирую сервисную архитектуру.`,
      rationale: 'Консультант сформулировал управленческий масштаб и стек.',
    };
    setLocalSuggestions((prev) => [...prev, suggestion]);
  };
  const dismissLocal = (id: string) => {
    setLocalSuggestions((prev) => prev.filter((item) => item.id !== id));
  };
  return {
    allSuggestions: [...(suggestions ?? []), ...localSuggestions],
    handleSuggest,
    dismissLocal,
  };
}

function useProfileAboutHandlers({
  draft,
  onSectionSave,
  onAcceptSuggestion,
  onDismissSuggestion,
  dismissLocal,
}: {
  readonly draft: ResumeDraft;
  readonly onSectionSave: (draft: ResumeDraft) => void;
  readonly onAcceptSuggestion?: (s: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (s: InlineSuggestionItem) => void;
  readonly dismissLocal: (id: string) => void;
}) {
  const handleAccept = useCallback(
    async (s: InlineSuggestionItem) => {
      if (onAcceptSuggestion) await onAcceptSuggestion(s);
      else onSectionSave(updateAbout(draft, s.proposedText));
      dismissLocal(s.id);
    },
    [draft, onSectionSave, onAcceptSuggestion, dismissLocal],
  );

  const handleDismiss = useCallback(
    (s: InlineSuggestionItem) => {
      onDismissSuggestion?.(s);
      dismissLocal(s.id);
    },
    [onDismissSuggestion, dismissLocal],
  );

  return { handleAccept, handleDismiss };
}

function useProfileAboutView(props: ProfileAboutSectionProps) {
  const { draft, onSectionSave, suggestions } = props;
  const [editing, setEditing] = useState(false);
  const about = draft.candidate.about?.trim();
  const { allSuggestions, handleSuggest, dismissLocal } = useProfileAboutSuggestions({
    about,
    suggestions,
    onSuggestWithConsultant: props.onSuggestWithConsultant,
  });
  const { handleAccept, handleDismiss } = useProfileAboutHandlers({
    draft,
    onSectionSave,
    onAcceptSuggestion: props.onAcceptSuggestion,
    onDismissSuggestion: props.onDismissSuggestion,
    dismissLocal,
  });
  return { editing, setEditing, about, allSuggestions, handleSuggest, handleAccept, handleDismiss };
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
      <SectionHead
        id="sec-about-title"
        title="Обо мне"
        imported={Boolean(about)}
        action={<SectionPencilButton label="Изменить «Обо мне»" onClick={() => setEditing(true)} />}
      />
      <AboutViewBody
        editing={editing}
        about={about}
        draft={draft}
        saving={saving}
        onSectionSave={(next) => {
          onSectionSave(next);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
      {!editing ? (
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
