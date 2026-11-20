import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import { Icon, InfoTip, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { RetryLine } from '../RetryLine';
import type { CompanyPeopleState } from './usePeople';
import './people.css';

const CIRCLES_TIP =
  'Круг 1 — вы знакомы, круг 2 — вас может представить общий контакт, круг 3 — холодный отклик.';

const ACTION_LABELS: Readonly<Record<B640CompanyPerson['nextStep'], string>> = {
  write_known_contact: 'Написать знакомому',
  ask_for_introduction: 'Попросить представить',
  cold_application: 'Холодный отклик',
};

function PersonRow({ person }: { readonly person: B640CompanyPerson }) {
  const title = person.platformMember ? (person.roleTitle ?? 'Участник платформы') : (person.name ?? 'Без имени');
  const role = person.platformMember ? 'имя скрыто' : person.roleTitle;
  return (
    <li className="row co-person">
      <div>
        <div className="row-title">{title}</div>
        {role ? <div className="row-sub">{role}</div> : null}
        {person.evidence ? (
          <div className="row-sub co-src">
            <Icon name="path" />
            {person.evidence}
          </div>
        ) : null}
      </div>
      <span className={person.circle === 1 ? 'tag ok' : 'tag'}>{`круг ${person.circle}`}</span>
      <Link className="btn" to={buildNodePath('o02', { responseId: person.vacancyId })}>
        {ACTION_LABELS[person.nextStep]}
      </Link>
    </li>
  );
}

/** B645: следующий шаг, когда знакомых нет: по вакансиям компании из подборки, иначе к рекрутерам в «Контактах». */
export type PeopleNext =
  | { readonly kind: 'vacancy'; readonly vacancyId: string }
  | { readonly kind: 'vacancies' }
  | { readonly kind: 'recruiter'; readonly company: string };

/** К «Вакансиям по вашим ролям» на этой же карточке: прокрутка и фокус на заголовке раздела. */
function toVacancies(): void {
  const heading = document.getElementById('co-vac');
  heading?.scrollIntoView({ block: 'start' });
  heading?.focus({ preventScroll: true });
}

function NextStep({ next }: { readonly next: PeopleNext }) {
  if (next.kind === 'vacancies') {
    return (
      <button className="btn" type="button" onClick={toVacancies}>
        Откликнуться на вакансию
      </button>
    );
  }
  if (next.kind === 'vacancy') {
    return (
      <Link className="btn" to={buildNodePath('v04', { vacancyId: next.vacancyId })}>
        Откликнуться на вакансию
      </Link>
    );
  }
  return (
    <Link className="btn" to={`${buildNodePath('a02')}?company=${encodeURIComponent(next.company)}`}>
      Найти рекрутера
    </Link>
  );
}

interface PeopleBodyProps {
  readonly state: CompanyPeopleState;
  readonly next: PeopleNext;
}

function PeopleBody({ state, next }: PeopleBodyProps) {
  if (state.load === 'loading') return <StatusLine state="wait" text="Ищем знакомых в компании…" />;
  if (state.load === 'error') return <RetryLine text="Не удалось загрузить людей компании" onRetry={state.retry} />;
  if (state.people.length === 0) {
    return (
      <div className="co-ppl-next">
        <p className="row-sub" role="status">
          Знакомых в компании не нашли
        </p>
        <NextStep next={next} />
      </div>
    );
  }
  return (
    <ul className="rows co-people">
      {state.people.map((person) => (
        <PersonRow key={person.id} person={person} />
      ))}
    </ul>
  );
}

/** «Люди компании из вашей сети»: круги 1–3, участники платформы без имени. */
export function CompanyPeople({ state, next }: PeopleBodyProps) {
  return (
    <section className="mod" aria-labelledby="co-ppl">
      <h3 className="mod-title" id="co-ppl">
        Люди компании из вашей сети
        <InfoTip label="Что значат круги" text={CIRCLES_TIP} />
      </h3>
      <PeopleBody state={state} next={next} />
    </section>
  );
}
