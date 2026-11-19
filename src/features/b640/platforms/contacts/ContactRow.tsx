import { useState } from 'react';
import type { B640Contact } from '../../../../../shared/b640Contacts';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { Icon, Link } from '../../kit';
import { MessageDraft } from '../../messages/MessageDraft';
import { buildNodePath } from '../../routes';
import { statusTag } from './contactsFilters';

/** Мишень имени 24 px, как у ссылки в макете (`.ct-row a.ct-n`); токен отступа. */
const NAME_BOX = { display: 'block', minBlockSize: 'var(--career-space-6)' } as const;
/** Панель черновика занимает обе колонки сетки строки. */
const PANEL_SPAN = { gridColumn: '1 / -1' } as const;

export interface ContactRowProps {
  readonly contact: B640Contact;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** «Отправил»: время отправки с сервера. */
  readonly onSent: (at: string) => void;
}

/** Адрес подготовки сообщения: сам экран с якорем, чтобы ссылка открывалась и в новой вкладке. */
export const writeHref = (id: string): string => `${buildNodePath('a02')}#write-${id}`;
const panelId = (id: string): string => `ct-write-${id}`;

/** Компания в подписи: цвет наследуется (`.b640 a`), подчёркивание только при наведении и фокусе. */
function CompanyLink({ name, to }: { readonly name: string; readonly to: string }) {
  const [underlined, setUnderlined] = useState(false);
  return (
    <Link
      to={to}
      style={{ textDecoration: underlined ? 'underline' : 'none' }}
      onMouseEnter={() => setUnderlined(true)}
      onMouseLeave={() => setUnderlined(false)}
      onFocus={() => setUnderlined(true)}
      onBlur={() => setUnderlined(false)}
    >
      {name}
    </Link>
  );
}

/** «должность · Компания»: компания — ссылка на карточку v10b, если она есть. */
function WorkLine({ contact }: { readonly contact: B640Contact }) {
  const role = contact.roleTitle.trim();
  const company = contact.companyName.trim();
  const key = companyLookupKey(company);
  return (
    <div className="row-sub ct-w">
      {role}
      {role && company ? ' · ' : ''}
      {key ? (
        <CompanyLink name={company} to={buildNodePath('v10b', { companyId: key })} />
      ) : (
        company
      )}
    </div>
  );
}

/** Имя открывает подготовку сообщения этому человеку; обычный щелчок не уходит с экрана. */
function Name({ contact, open, onToggle }: Omit<ContactRowProps, 'onSent'>) {
  return (
    <a
      className="row-title ct-n"
      style={NAME_BOX}
      href={writeHref(contact.id)}
      aria-expanded={open}
      aria-controls={panelId(contact.id)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onToggle();
      }}
    >
      {contact.fullName}
    </a>
  );
}

/** Строка контакта (a02): имя открывает черновик, должность и компания, метка статуса, путь знакомства. */
export function ContactRow({ contact, open, onToggle, onSent }: ContactRowProps) {
  const tag = statusTag(contact.status);
  const note = contact.linkNote?.trim();
  return (
    <li className="row ct-row ct-row2">
      <Name contact={contact} open={open} onToggle={onToggle} />
      <WorkLine contact={contact} />
      <div className="ct-tags">
        <span className={tag.cls}>{tag.text}</span>
      </div>
      {note ? (
        <div className="row-sub ct-p">
          <Icon name="path" />
          {note}
        </div>
      ) : null}
      {open ? (
        <div id={panelId(contact.id)} style={PANEL_SPAN}>
          <MessageDraft
            target={{ contactId: contact.id }}
            kind={contact.link === 'intro' ? 'ask_introduction' : 'known_contact'}
            recipientName={contact.fullName}
            onSent={onSent}
            onClose={onToggle}
          />
        </div>
      ) : null}
    </li>
  );
}
