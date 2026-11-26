import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import type { RecruiterContact } from '../../../../../shared/recruiterContact';
import { Icon, Link } from '../../kit';
import { PLATFORM_MEMBER, writeLabel } from './acquaintances';
import type { ComposeAction } from './waysModel';

export interface HireBlockProps {
  readonly company: string;
  readonly people: readonly B640CompanyPerson[];
  /** `null` — у вакансии нет компании: ссылки на её карточку нет. */
  readonly companyPath: string | null;
  /** Рекрутёр вакансии: первой строкой, как в макете. */
  readonly recruiter?: RecruiterContact | undefined;
  readonly vacancyId: string;
  /** Имя — ссылка к письму этому человеку (макет a02d: `a.row-title` → письмо). */
  readonly onWrite: (action: ComposeAction) => void;
}

function composeFor(name: string, message: ComposeAction['message']): ComposeAction {
  return { kind: 'compose', label: writeLabel(name), recipient: name, message };
}

function NameLink({
  name,
  action,
  onWrite,
}: {
  name: string;
  action: ComposeAction | null;
  onWrite: HireBlockProps['onWrite'];
}) {
  if (!action) return <div className="row-title">{name}</div>;
  return (
    <a
      className="row-title"
      href={`#write-${encodeURIComponent(name)}`}
      onClick={(event) => {
        event.preventDefault();
        onWrite(action);
      }}
    >
      {name}
    </a>
  );
}

function CircleTag({ circle }: { readonly circle: B640CompanyPerson['circle'] }) {
  if (circle === 3) return null;
  return <span className={circle === 1 ? 'tag ok' : 'tag'}>{`${circle}-й круг`}</span>;
}

function RecruiterRow({
  recruiter,
  vacancyId,
  onWrite,
}: Required<Pick<HireBlockProps, 'vacancyId' | 'onWrite'>> & {
  readonly recruiter: RecruiterContact;
}) {
  const action = composeFor(recruiter.fullName, {
    kind: 'recruiter',
    target: { recruiterId: recruiter.id, vacancyId },
  });
  return (
    <li className="row hire-row">
      <div>
        <NameLink name={recruiter.fullName} action={action} onWrite={onWrite} />
        {recruiter.roleTitle ? <div className="row-sub">{recruiter.roleTitle}</div> : null}
      </div>
    </li>
  );
}

/** «Кто нанимает в <компания>» шага «Отклик» (a02d): люди компании, путь до них, карточка компании. */
export function HireBlock({
  company,
  people,
  companyPath,
  recruiter,
  vacancyId,
  onWrite,
}: HireBlockProps) {
  return (
    <section className="mod hire" aria-label={`Кто нанимает в ${company}`}>
      <div className="lead-head">
        <h3 className="mod-title">{`Кто нанимает в ${company}`}</h3>
      </div>
      {people.length > 0 || recruiter ? (
        <ul className="rows hire-rows">
          {recruiter ? (
            <RecruiterRow recruiter={recruiter} vacancyId={vacancyId} onWrite={onWrite} />
          ) : null}
          {people.map((person) => (
            <li className="row hire-row" key={person.id}>
              <div>
                <NameLink
                  name={person.platformMember ? PLATFORM_MEMBER : (person.name ?? 'Без имени')}
                  action={
                    person.name && person.message ? composeFor(person.name, person.message) : null
                  }
                  onWrite={onWrite}
                />
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
      {companyPath ? (
        <Link className="row-act hire-card" to={companyPath}>
          <Icon name="building" />
          Вакансии и люди компании
        </Link>
      ) : null}
    </section>
  );
}
