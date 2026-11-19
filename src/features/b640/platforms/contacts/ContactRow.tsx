import type { B640Contact } from '../../../../../shared/b640Contacts';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { statusTag } from './contactsFilters';
import { workLine } from './contactsModel';

/** Мишень имени 24 px, как у ссылки в макете (`.ct-row a.ct-n`); токен отступа. */
const NAME_BOX = { display: 'block', minBlockSize: 'var(--career-space-6)' } as const;

export interface ContactRowProps {
  readonly contact: B640Contact;
}

/** Имя ведёт на карточку компании (v10b); без компании — просто текст. */
function Name({ contact }: ContactRowProps) {
  const key = companyLookupKey(contact.companyName);
  if (!key) {
    return (
      <div className="row-title ct-n" style={NAME_BOX}>
        {contact.fullName}
      </div>
    );
  }
  return (
    <Link
      className="row-title ct-n"
      style={NAME_BOX}
      to={buildNodePath('v10b', { companyId: key })}
    >
      {contact.fullName}
    </Link>
  );
}

/** Строка контакта (a02): имя-ссылка на компанию, должность и компания, метка статуса, путь знакомства. */
export function ContactRow({ contact }: ContactRowProps) {
  const tag = statusTag(contact.status);
  const note = contact.linkNote?.trim();
  return (
    <li className="row ct-row ct-row2">
      <Name contact={contact} />
      <div className="row-sub ct-w">{workLine(contact)}</div>
      <div className="ct-tags">
        <span className={tag.cls}>{tag.text}</span>
      </div>
      {note ? (
        <div className="row-sub ct-p">
          <Icon name="path" />
          {note}
        </div>
      ) : null}
    </li>
  );
}
