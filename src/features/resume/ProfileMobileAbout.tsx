import { useState } from 'react';
import { useProfileProvenance } from './ProfileProvenanceChip';
import { aboutProvenance, provenanceSourceValue } from './profileProvenance';
import { PencilSimple, Sparkle } from '@phosphor-icons/react';
import { parseAboutContent } from './profileAbout';
import { updateAbout } from './profileEntryEditing';
import { useProfileEntrySave } from './profileEntrySave';
import { ProfileMobileGroup, ProfileMobileRow } from './ProfileMobileElements';
import { InlineConsultantSuggestion } from './InlineConsultantSuggestion';
import type { ProfileMobileDataProps } from './profileMobileTypes';

function MobileAboutEditor(props: ProfileMobileDataProps & { readonly onClose: () => void }) {
  const [text, setText] = useState(props.draft.candidate.about ?? '');
  const submit = useProfileEntrySave(
    async (about: string) => {
      const result = await props.onSectionSave(updateAbout(props.draft, about));
      if (result !== false) props.onClose();
      return result;
    },
    () => undefined,
  );
  return (
    <form
      className="pm-view"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.save(text);
      }}
    >
      <ProfileMobileGroup>
        <textarea
          className="pm-area"
          aria-label="Обо мне"
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </ProfileMobileGroup>
      {submit.error ? (
        <p role="alert" className="career-resume-error">
          {submit.error}
        </p>
      ) : null}
      <div className="pm-savebar">
        <button type="submit" className="pm-cta" disabled={props.saving || submit.busy}>
          Сохранить
        </button>
      </div>
      <button type="button" className="pm-text" onClick={props.onClose}>
        Отменить
      </button>
    </form>
  );
}

function MobileAboutText({ text }: { readonly text: string }) {
  return (
    <div className="pm-quote profile-mobile-about-text">
      {parseAboutContent(text).map((block, index) =>
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
  );
}

function MobileAboutOrigin({ about }: { readonly about: string }) {
  const { memory } = useProfileProvenance();
  return <p className="pm-foot">{provenanceSourceValue(aboutProvenance(about, memory))}.</p>;
}

export function ProfileMobileAbout(props: ProfileMobileDataProps) {
  const [editing, setEditing] = useState(false);
  if (editing) return <MobileAboutEditor {...props} onClose={() => setEditing(false)} />;
  const about = props.draft.candidate.about?.trim();
  return (
    <>
      {about ? <MobileAboutText text={about} /> : <p className="pm-note">Раздел пока пуст.</p>}
      {about ? <MobileAboutOrigin about={about} /> : null}
      <ProfileMobileGroup>
        <ProfileMobileRow
          icon={PencilSimple}
          title="Изменить текст"
          onClick={() => setEditing(true)}
        />
        <ProfileMobileRow
          icon={Sparkle}
          title="Предложить вариант с консультантом"
          onClick={props.onSuggestAboutWithConsultant}
        />
      </ProfileMobileGroup>
      {(props.suggestions ?? [])
        .filter((suggestion) => suggestion.section === 'about')
        .map((suggestion) => (
          <InlineConsultantSuggestion
            key={suggestion.id}
            suggestion={suggestion}
            onAccept={async (item) => {
              if (props.onAcceptSuggestion) await props.onAcceptSuggestion(item);
              else if (
                (await props.onSectionSave(updateAbout(props.draft, item.proposedText))) === false
              )
                throw new Error('Не удалось сохранить правку. Попробуйте ещё раз.');
            }}
            onDismiss={props.onDismissSuggestion}
            onRevert={props.onRevertSuggestion}
          />
        ))}
    </>
  );
}
