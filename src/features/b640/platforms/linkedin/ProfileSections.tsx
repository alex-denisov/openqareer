import { useState } from 'react';
import type {
  LinkedinProfileView,
  LinkedinSection,
  LinkedinSectionCurrent,
  LinkedinSectionView,
} from '../../../../../shared/b640LinkedinProfile';
import { PasteField } from './PasteField';
import { SectionOffer } from './SectionOffer';
import { currentCaption, PROFILE_SECTIONS } from './profileSectionModel';

interface SectionCardProps {
  readonly section: LinkedinSection;
  readonly title: string;
  readonly view: LinkedinSectionView;
  readonly onChange: (patch: Partial<LinkedinSectionView>) => void;
}

interface CurrentBlockProps {
  readonly section: LinkedinSection;
  readonly title: string;
  readonly current: LinkedinSectionCurrent | null;
  readonly onSaved: (current: LinkedinSectionCurrent) => void;
}

/** «Сейчас»: текст с источником и «Обновить», либо поле вставки, если текста ещё нет. */
function CurrentBlock({ section, title, current, onSaved }: CurrentBlockProps) {
  const [editing, setEditing] = useState(false);
  if (!current || editing) {
    const saved = (next: LinkedinSectionCurrent) => {
      setEditing(false);
      onSaved(next);
    };
    return <PasteField section={section} title={title} initial={current?.text} onSaved={saved} />;
  }
  return (
    <>
      <div className="li-cur-h">
        <p className="li-rec-l">{currentCaption(current)}</p>
        <button className="btn is-sm" type="button" aria-label={`Обновить: ${title}`} onClick={() => setEditing(true)}>
          Обновить
        </button>
      </div>
      <p className="li-cur">{current.text}</p>
    </>
  );
}

function SectionCard({ section, title, view, onChange }: SectionCardProps) {
  const titleId = `ls-${section}`;
  return (
    <section className="li-sec" aria-labelledby={titleId}>
      <h3 className="li-sec-t" id={titleId}>
        {title}
      </h3>
      <div className="li-rec">
        <CurrentBlock section={section} title={title} current={view.current} onSaved={(current) => onChange({ current })} />
        {view.suggestion ? (
          <SectionOffer
            section={section}
            title={title}
            suggestion={view.suggestion}
            pastedAt={view.pastedAt}
            onMarks={onChange}
          />
        ) : null}
      </div>
    </section>
  );
}

/** Четыре раздела профиля: «Сейчас» и предложение; правки живут в состоянии экрана, исходные данные не меняются. */
export function ProfileSections({ initial }: { readonly initial: LinkedinProfileView }) {
  const [profile, setProfile] = useState<LinkedinProfileView>(initial);
  return (
    <>
      {PROFILE_SECTIONS.map(({ id, title }) => (
        <SectionCard
          key={id}
          section={id}
          title={title}
          view={profile[id]}
          onChange={(patch) =>
            setProfile((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }))
          }
        />
      ))}
    </>
  );
}
