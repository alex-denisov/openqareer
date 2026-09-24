import { useState } from 'react';
import { parseAboutContent } from './profileAbout';
import { updateAbout } from './profileEntryEditing';
import { SectionEditActions, SectionPencilButton } from './ProfileSectionEdit';
import { SectionHead } from './ProfileSectionHead';
import type { ResumeDraft } from './resumeTypes';

interface ProfileAboutSectionProps {
  readonly draft: ResumeDraft;
  readonly saving?: boolean;
  readonly onSectionSave: (next: ResumeDraft) => void;
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

export function ProfileAboutSection({ draft, saving, onSectionSave }: ProfileAboutSectionProps) {
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
      {editing ? (
        <AboutEditForm
          draft={draft}
          saving={saving}
          onSectionSave={(next) => {
            onSectionSave(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : about ? (
        <AboutContent about={about} />
      ) : (
        <p className="career-profile-screen-empty-note">Раздел «Обо мне» ещё не заполнен.</p>
      )}
    </section>
  );
}
