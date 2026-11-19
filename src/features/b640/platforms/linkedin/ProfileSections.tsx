import { useState } from 'react';
import type {
  LinkedinProfileView,
  LinkedinSection,
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

function SectionCard({ section, title, view, onChange }: SectionCardProps) {
  const titleId = `ls-${section}`;
  return (
    <section className="li-sec" aria-labelledby={titleId}>
      <h3 className="li-sec-t" id={titleId}>
        {title}
      </h3>
      <div className="li-rec">
        {view.current ? (
          <>
            <p className="li-rec-l">{currentCaption(view.current)}</p>
            <p className="li-cur">{view.current.text}</p>
          </>
        ) : (
          <PasteField section={section} title={title} onSaved={(current) => onChange({ current })} />
        )}
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
