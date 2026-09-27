import { useState } from 'react';
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
  const blocks = parseAboutContent(about);
  return (
    <>
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
    </>
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
            onAcceptSuggestion ??
            ((s) => onSectionSave(updateAbout(draft, s.proposedText)))
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

export function ProfileAboutSection({
  draft,
  saving,
  onSectionSave,
  suggestions,
  onAcceptSuggestion,
  onDismissSuggestion,
  onRevertSuggestion,
}: ProfileAboutSectionProps) {
  const [editing, setEditing] = useState(false);
  const about = draft.candidate.about?.trim();

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
        action={
          <SectionPencilButton label="Изменить «Обо мне»" onClick={() => setEditing(true)} />
        }
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
      <AboutSuggestionsList
        draft={draft}
        suggestions={suggestions}
        onSectionSave={onSectionSave}
        onAcceptSuggestion={onAcceptSuggestion}
        onDismissSuggestion={onDismissSuggestion}
        onRevertSuggestion={onRevertSuggestion}
      />
    </section>
  );
}

