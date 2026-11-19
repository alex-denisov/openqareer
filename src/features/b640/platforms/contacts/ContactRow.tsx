import { useEffect, useId, useRef, useState } from 'react';
import { B640_CONTACT_STATES, type B640Contact, type B640ContactState } from '../../../../../shared/b640Contacts';
import { Icon, StatusLine } from '../../kit';
import { STATE_LABELS, statusTag } from './contactsFilters';
import { workLine } from './contactsModel';

export interface ContactRowProps {
  readonly contact: B640Contact;
  readonly busy: boolean;
  /** Не сохранился этот статус; «Повторить» ставит его ещё раз. */
  readonly failedTo: B640ContactState | undefined;
  readonly onChange: (contact: B640Contact, state: B640ContactState) => void;
}

/** Меню статуса: закрывается по Esc и по нажатию мимо. */
function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    const onPointer = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, close]);
  return root;
}

function StatusMenu({ contact, busy, onChange }: Pick<ContactRowProps, 'contact' | 'busy' | 'onChange'>) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useDismiss(open, () => setOpen(false));
  return (
    <span className="va-menuwrap" ref={root}>
      <button
        className="icon-btn"
        type="button"
        aria-label={`Статус: ${contact.fullName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={busy}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <ul className="va-menu" id={menuId} role="menu" aria-label="Сменить статус">
          {B640_CONTACT_STATES.map((state) => (
            <li key={state} role="none">
              <button
                className="va-mi"
                type="button"
                role="menuitemradio"
                aria-checked={contact.status.state === state}
                onClick={() => {
                  setOpen(false);
                  onChange(contact, state);
                }}
              >
                {contact.status.state === state ? <Icon name="check" /> : <span className="ico" aria-hidden="true" />}
                <span>{STATE_LABELS[state]}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

/** Строка контакта (a02): имя, должность и компания, метка статуса, путь знакомства. */
export function ContactRow({ contact, busy, failedTo, onChange }: ContactRowProps) {
  const tag = statusTag(contact.status);
  const note = contact.linkNote?.trim();
  return (
    <li className="row ct-row ct-row2">
      <span className="row-title ct-n">{contact.fullName}</span>
      <div className="row-sub ct-w">{workLine(contact)}</div>
      <div className="ct-tags">
        <span className={tag.cls}>{tag.text}</span>
        <StatusMenu contact={contact} busy={busy} onChange={onChange} />
      </div>
      {note ? (
        <div className="row-sub ct-p">
          <Icon name="path" />
          {note}
        </div>
      ) : null}
      {failedTo ? (
        <StatusLine
          state="err"
          text="Статус не сохранился"
          action={
            <button className="btn is-sm" type="button" onClick={() => onChange(contact, failedTo)}>
              Повторить
            </button>
          }
        />
      ) : null}
    </li>
  );
}
