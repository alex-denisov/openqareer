import type { ResumeDocument } from '../../resume/resumeTypes';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';

/** Место работы без начала или конца: в резюме у него неполный период. */
export function placeWithoutDates(document: ResumeDocument | null): string | null {
  const place = document?.experience.find(
    (item) => !item.startDate?.value || (!item.current.value && !item.endDate?.value),
  );
  return place ? place.employer?.value || place.title?.value || null : null;
}

export function ResumeDates({ document }: { readonly document: ResumeDocument | null }) {
  const name = placeWithoutDates(document);
  if (!name) return null;
  return (
    <section className="mod" aria-labelledby="rs-gap">
      <h3 className="mod-title" id="rs-gap">{`Даты в «${name}»`}</h3>
      <div className="actions">
        <Link className="btn" to={`${buildNodePath('s01')}#sec-exp`}>
          <Icon name="calendar" />
          Уточнить даты
        </Link>
      </div>
    </section>
  );
}
