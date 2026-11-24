import { useState } from 'react';
import type { B640Connection } from '../../../../shared/b640Connections';
import { Link } from '../kit';
import { MessageDraft } from '../messages/MessageDraft';
import { statusTag } from '../platforms/contacts/contactsFilters';
import { buildNodePath } from '../routes';
import { connectionNote, type ConnectionGroup } from './connectionsModel';

/** Открытый черновик (один за раз) и отметки «Отправил» этого визита. */
interface DraftState {
  readonly openId: string | null;
  readonly sent: ReadonlyMap<string, string>;
  readonly onToggle: (id: string) => void;
  readonly onSent: (id: string, at: string) => void;
}

interface RowProps {
  readonly person: B640Connection;
  readonly lead: boolean;
  readonly draft: DraftState;
}

function RowName({ person }: { readonly person: B640Connection }) {
  const note = connectionNote(person);
  const body = (
    <>
      <div className="row-title">
        {person.fullName}
        <span className={person.circle === 1 ? 'tag ln-chip-m ok' : 'tag ln-chip-m'}>
          {`${person.circle}-й`}
        </span>
      </div>
      <div className="row-sub" title={note}>
        {note}
      </div>
    </>
  );
  // Строка ведёт к письму по вакансии компании; без вакансии в подборке письма нет.
  return person.vacancyId ? (
    <Link className="ln-open" to={buildNodePath('o02', { responseId: person.vacancyId })}>
      {body}
    </Link>
  ) : (
    <div className="ln-open">{body}</div>
  );
}

function RowAction({ person, lead, draft }: RowProps) {
  const sentAt = draft.sent.get(person.id);
  if (sentAt) {
    const tag = statusTag({ state: 'written', at: sentAt });
    return <span className={tag.cls}>{tag.text}</span>;
  }
  const direct = person.circle === 1;
  const label = direct ? 'Написать' : 'Попросить представить';
  return (
    <button
      className={lead ? 'btn is-sm is-primary' : 'btn is-sm'}
      type="button"
      aria-label={`${label}: ${person.fullName}`}
      aria-expanded={draft.openId === person.id}
      onClick={() => draft.onToggle(person.id)}
    >
      <span className="ln-bd">{label}</span>
      <span className="ln-bm">{direct ? label : 'Представить'}</span>
    </button>
  );
}

function Row(props: RowProps) {
  const { person, lead, draft } = props;
  return (
    <>
      <li className={lead ? 'row ln-row is-next' : 'row ln-row'}>
        <RowName person={person} />
        <span className="ln-end">
          <span className={person.circle === 1 ? 'tag ln-tag-d ok' : 'tag ln-tag-d'}>
            {`${person.circle}-й круг`}
          </span>
          <RowAction {...props} />
        </span>
      </li>
      {draft.openId === person.id ? (
        <li>
          <MessageDraft
            target={person.message.target}
            kind={person.message.kind}
            recipientName={person.via ?? person.fullName}
            onSent={(at) => draft.onSent(person.id, at)}
            onClose={() => draft.onToggle(person.id)}
          />
        </li>
      ) : null}
    </>
  );
}

/** Связи по компаниям: круг, строка к письму, «Написать» или «Попросить представить». */
export function ConnectionRows({ groups }: { readonly groups: readonly ConnectionGroup[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [sent, setSent] = useState<ReadonlyMap<string, string>>(new Map());
  const draft: DraftState = {
    openId,
    sent,
    onToggle: (id) => setOpenId((current) => (current === id ? null : id)),
    onSent: (id, at) => {
      setSent((before) => new Map([...before, [id, at]]));
      setOpenId(null);
    },
  };
  // Одно залитое действие на экране: пока открыт черновик, оно в нём.
  const leadId = openId ? null : groups[0]?.people[0]?.id;
  return (
    <ul className="ln-list" aria-label="Связи по компаниям">
      {groups.map((group) => (
        <li className="ln-co" key={group.company}>
          <h3 className="ln-co-t">
            {group.company}
            <span className="dim">{group.inSelection ? ' · в подборке' : ''}</span>
          </h3>
          <ul className="rows">
            {group.people.map((person) => (
              <Row key={person.id} person={person} lead={person.id === leadId} draft={draft} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
