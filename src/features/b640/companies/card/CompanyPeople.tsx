import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import { Icon, InfoTip, Link, StatusLine } from '../../kit';
import { MessageDraft } from '../../messages/MessageDraft';
import { statusTag } from '../../platforms/contacts/contactsFilters';
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

/** Какая строка открыта: черновик одной строки за раз; шапка открывает строку знакомого. */
export interface PeopleDraft {
  readonly openId: string | null;
  readonly onToggle: (personId: string) => void;
  /** Отмечено «Отправил» в этом визите: id человека → время отправки с сервера. */
  readonly sent: ReadonlyMap<string, string>;
  readonly onSent: (personId: string, sentAt: string) => void;
}

export const personRowId = (personId: string): string =>
  `co-person-${personId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;

function PersonAction({
  person,
  draft,
}: {
  readonly person: B640CompanyPerson;
  readonly draft: PeopleDraft;
}) {
  const label = ACTION_LABELS[person.nextStep];
  const sentAt = draft.sent.get(person.id);
  if (sentAt) {
    // B698: результат отправки виден в строке, как «писали ДД.ММ» в «Контактах».
    const tag = statusTag({ state: 'written', at: sentAt });
    return <span className={`co-sent ${tag.cls}`}>{tag.text}</span>;
  }
  if (person.message && person.name) {
    const open = draft.openId === person.id;
    return (
      <button
        className="btn"
        type="button"
        aria-expanded={open}
        onClick={() => draft.onToggle(person.id)}
      >
        {label}
      </button>
    );
  }
  if (!person.vacancyId) return null;
  return (
    <Link className="btn" to={buildNodePath('o02', { responseId: person.vacancyId })}>
      {label}
    </Link>
  );
}

function PersonRow({
  person,
  draft,
}: {
  readonly person: B640CompanyPerson;
  readonly draft: PeopleDraft;
}) {
  const title = person.platformMember
    ? (person.roleTitle ?? 'Участник платформы')
    : (person.name ?? 'Без имени');
  const role = person.platformMember ? 'имя скрыто' : person.roleTitle;
  const open = draft.openId === person.id && person.message && person.name;
  return (
    <li className="row co-person" id={personRowId(person.id)}>
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
      <PersonAction person={person} draft={draft} />
      {open && person.message && person.name ? (
        <div className="co-write">
          <MessageDraft
            target={person.message.target}
            kind={person.message.kind}
            recipientName={person.name}
            onSent={(sentAt) => draft.onSent(person.id, sentAt)}
            onClose={() => draft.onToggle(person.id)}
          />
        </div>
      ) : null}
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
    <Link
      className="btn"
      to={`${buildNodePath('a02')}?company=${encodeURIComponent(next.company)}`}
    >
      Найти рекрутера
    </Link>
  );
}

interface PeopleBodyProps {
  readonly state: CompanyPeopleState;
  readonly next: PeopleNext;
  readonly draft: PeopleDraft;
}

function PeopleBody({ state, next, draft }: PeopleBodyProps) {
  if (state.load === 'loading') return <StatusLine state="wait" text="Ищем знакомых в компании…" />;
  if (state.load === 'error')
    return <RetryLine text="Не удалось загрузить людей компании" onRetry={state.retry} />;
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
        <PersonRow key={person.id} person={person} draft={draft} />
      ))}
    </ul>
  );
}

/** «Люди компании из вашей сети»: круги 1–3, участники платформы без имени. */
export function CompanyPeople({ state, next, draft }: PeopleBodyProps) {
  return (
    <section className="mod" aria-labelledby="co-ppl">
      <h3 className="mod-title" id="co-ppl">
        Люди компании из вашей сети
        <InfoTip label="Что значат круги" text={CIRCLES_TIP} />
      </h3>
      <PeopleBody state={state} next={next} draft={draft} />
    </section>
  );
}
