import type { CandidateConnectionContact } from '../../../outreach/connectionContactsApi';
import { Icon } from '../../kit';
import { workLine } from './contactsModel';

/** Строка контакта (a02): имя, должность и компания, как вы знакомы. */
export function ContactRow({ contact }: { readonly contact: CandidateConnectionContact }) {
  const how = contact.relationship.trim();
  return (
    <li className="row ct-row ct-row2">
      <span className="row-title ct-n">{contact.fullName}</span>
      <div className="row-sub ct-w">{workLine(contact)}</div>
      {how ? (
        <div className="row-sub ct-p">
          <Icon name="path" />
          {how}
        </div>
      ) : null}
    </li>
  );
}
