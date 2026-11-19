import { useId } from 'react';
import type { B640Contact } from '../../../../../shared/b640Contacts';
import { Button, Dialog, StatusLine } from '../../kit';
import { messageKind, useContactMessage } from './useContactMessage';

export interface ContactMessageDialogProps {
  readonly contact: B640Contact;
  readonly onClose: () => void;
  /** Письмо отмечено отправленным: строка получает статус «писали». */
  readonly onSent: (contact: B640Contact, sentAt: string) => void;
}

const titleOf = (contact: B640Contact) =>
  messageKind(contact) === 'ask_introduction'
    ? `Попросить представить: ${contact.fullName}`
    : `Написать: ${contact.fullName}`;

interface BodyProps {
  readonly contact: B640Contact;
  readonly onClose: () => void;
  readonly onSent: (sentAt: string) => void;
}

function Notes({ state }: { readonly state: ReturnType<typeof useContactMessage> }) {
  const { failure, pending, message, notice } = state;
  return (
    <>
      {pending && !message ? <StatusLine state="wait" text="Готовим черновик…" /> : null}
      {failure ? (
        <StatusLine
          state="err"
          text={failure.text}
          action={
            <button className="btn is-sm" type="button" onClick={failure.retry}>
              Повторить
            </button>
          }
        />
      ) : null}
      {notice ? <StatusLine state="wait" text={notice} /> : null}
    </>
  );
}

function Body({ contact, onClose, onSent }: BodyProps) {
  const fieldId = useId();
  const state = useContactMessage(contact, onSent);
  const { message, pending } = state;
  const approved = state.step === 'approved';
  return (
    <>
      <div className="lk-dr-top">
        <label className="lk-lbl" htmlFor={fieldId}>
          Черновик
        </label>
      </div>
      {message ? (
        <textarea
          className="lk-draft lk-edit"
          id={fieldId}
          rows={5}
          value={state.text}
          disabled={pending}
          onChange={(event) => state.setText(event.currentTarget.value)}
        />
      ) : null}
      <Notes state={state} />
      <div className="actions">
        <Button
          variant={approved ? 'default' : 'primary'}
          icon="check"
          disabled={!message || !state.text.trim()}
          busy={pending}
          onClick={state.approve}
        >
          Скопировать и открыть
        </Button>
        {approved ? (
          <Button variant="primary" icon="send" busy={pending} onClick={state.markSent}>
            Отправил
          </Button>
        ) : null}
        <Button variant="quiet" onClick={onClose}>
          Не отправлять
        </Button>
      </div>
    </>
  );
}

/** a02d / a02e: «Написать <имя>» и «Попросить представить» окном; текст правит и одобряет кандидат. */
export function ContactMessageDialog({ contact, onClose, onSent }: ContactMessageDialogProps) {
  return (
    <Dialog open onClose={onClose} title={titleOf(contact)}>
      <Body contact={contact} onClose={onClose} onSent={(sentAt) => onSent(contact, sentAt)} />
    </Dialog>
  );
}
