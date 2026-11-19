import { useState } from 'react';
import { pluralRu } from '../../../../../shared/pluralRu';
import type { LinkedinOffer, LinkedinPlace, LinkedinSectionView } from '../../../../../shared/b640LinkedinProfile';
import { Icon } from '../../kit';
import { LiError } from './LiError';
import { markOffersDone } from './linkedinProfileApi';
import { changeTitle, pendingKeys, SECTION_TITLES, withDone, withOffer } from './profileSectionModel';
import { SectionOffer } from './SectionOffer';

/** Как в «Профиле»: два места работы на виду, остальные — под «Ещё N мест работы». */
const PLACES_VISIBLE = 2;

interface OfferHandlers {
  readonly onDone: (key: string) => Promise<void>;
  readonly onVariant: (offer: LinkedinOffer) => void;
}

function Place({ place, handlers }: { readonly place: LinkedinPlace; readonly handlers: OfferHandlers }) {
  return (
    <div className="li-rec">
      <p className="li-rec-l">{place.label}</p>
      {place.current ? <p className="li-cur">{place.current}</p> : null}
      {place.offer ? <SectionOffer offer={place.offer} label={place.label} {...handlers} /> : null}
    </div>
  );
}

function Places({ places, handlers }: { readonly places: readonly LinkedinPlace[]; readonly handlers: OfferHandlers }) {
  const shown = places.slice(0, PLACES_VISIBLE);
  const rest = places.slice(PLACES_VISIBLE);
  const names = rest.map((place) => place.label.split(' · ')[0]).join(', ');
  return (
    <>
      {shown.map((place) => (
        <Place key={place.id} place={place} handlers={handlers} />
      ))}
      {rest.length > 0 ? (
        <details className="more-n">
          <summary>
            <Icon name="down" />
            {`Ещё ${pluralRu(rest.length, ['место работы', 'места работы', 'мест работы'])}`}
            <span className="dim">{` · ${names}`}</span>
          </summary>
          {rest.map((place) => (
            <Place key={place.id} place={place} handlers={handlers} />
          ))}
        </details>
      ) : null}
    </>
  );
}

function Section({ section, handlers }: { readonly section: LinkedinSectionView; readonly handlers: OfferHandlers }) {
  const title = SECTION_TITLES[section.id];
  const titleId = `ls-${section.id}`;
  const empty = !section.current && !section.offer && !section.places?.length;
  return (
    <section className="li-sec" aria-labelledby={titleId}>
      <h3 className="li-sec-t" id={titleId}>
        {title}
      </h3>
      {section.places ? <Places places={section.places} handlers={handlers} /> : null}
      {section.places ? null : (
        <div className="li-rec">
          {section.current ? <p className="li-cur">{section.current}</p> : null}
          {empty ? <p className="li-cur">В импорте LinkedIn этого раздела нет</p> : null}
          {section.offer ? <SectionOffer offer={section.offer} label={title} {...handlers} /> : null}
        </div>
      )}
    </section>
  );
}

function useProfile(initial: readonly LinkedinSectionView[]) {
  const [sections, setSections] = useState<readonly LinkedinSectionView[]>(initial);
  const [allBusy, setAllBusy] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  const done = async (keys: readonly string[]) => {
    const result = await markOffersDone(keys);
    setSections((previous) => withDone(previous, result.done));
  };
  const handlers: OfferHandlers = {
    onDone: (key) => done([key]),
    onVariant: (offer) => setSections((previous) => withOffer(previous, offer)),
  };
  async function doneAll() {
    setAllBusy(true);
    setAllFailed(false);
    try {
      await done(pendingKeys(sections));
    } catch {
      setAllFailed(true);
    } finally {
      setAllBusy(false);
    }
  }
  return { sections, handlers, allBusy, allFailed, doneAll };
}

/** Семь разделов макета a03: «сейчас» из импорта LinkedIn и предложения; «Отметить все выполненными». */
export function ProfileSections({ initial }: { readonly initial: readonly LinkedinSectionView[] }) {
  const { sections, handlers, allBusy, allFailed, doneAll } = useProfile(initial);
  const pending = pendingKeys(sections).length > 0;
  return (
    <>
      <section className="lead li-opt" aria-labelledby="li-title">
        <h2 className="lead-title" id="li-title">
          {changeTitle(sections)}
        </h2>
        {pending ? (
          <div className="actions li-all">
            <button className="btn is-primary" type="button" aria-busy={allBusy || undefined} disabled={allBusy} onClick={() => void doneAll()}>
              <Icon name="check" />
              Отметить все выполненными
            </button>
          </div>
        ) : null}
        {allFailed ? <LiError text="Не удалось сохранить отметки" onRetry={() => void doneAll()} /> : null}
      </section>
      {sections.map((section) => (
        <Section key={section.id} section={section} handlers={handlers} />
      ))}
    </>
  );
}
