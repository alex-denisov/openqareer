import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import { Icon, Link } from '../../kit';
import { PLATFORM_MEMBER } from './acquaintances';

export interface HireBlockProps {
  readonly company: string;
  readonly people: readonly B640CompanyPerson[];
  readonly companyPath: string;
}

function CircleTag({ circle }: { readonly circle: B640CompanyPerson['circle'] }) {
  if (circle === 3) return null;
  return <span className={circle === 1 ? 'tag ok' : 'tag'}>{`${circle}-й круг`}</span>;
}

/** «Кто нанимает в <компания>» шага «Отклик» (a02d): люди компании, путь до них, карточка компании. */
export function HireBlock({ company, people, companyPath }: HireBlockProps) {
  return (
    <section className="mod hire" aria-label={`Кто нанимает в ${company}`}>
      <div className="lead-head">
        <h3 className="mod-title">{`Кто нанимает в ${company}`}</h3>
      </div>
      {people.length > 0 ? (
        <ul className="rows hire-rows">
          {people.map((person) => (
            <li className="row hire-row" key={person.id}>
              <div>
                <div className="row-title">
                  {person.platformMember ? PLATFORM_MEMBER : (person.name ?? 'Без имени')}
                </div>
                {person.roleTitle ? <div className="row-sub">{person.roleTitle}</div> : null}
                {person.evidence ? (
                  <div className="row-sub hire-path">
                    <Icon name="path" />
                    {person.evidence}
                  </div>
                ) : null}
              </div>
              <CircleTag circle={person.circle} />
            </li>
          ))}
        </ul>
      ) : null}
      <Link className="row-act hire-card" to={companyPath}>
        <Icon name="building" />
        Вакансии и люди компании
      </Link>
    </section>
  );
}
