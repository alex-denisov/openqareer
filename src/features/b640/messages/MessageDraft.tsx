import { useId } from 'react';
import { VariantButton, VariantSwitch } from '../apply/VariantControls';
import { Button, StatusLine } from '../kit';
import type { B640ContactMessageKind, B640MessageTarget } from './contactMessageApi';
import { useContactMessage } from './useContactMessage';

export interface MessageDraftProps {
  /** Кому: знакомый из сети (`contactId`) или рекрутёр вакансии (`recruiterId` и `vacancyId`). */
  readonly target: B640MessageTarget;
  readonly kind: B640ContactMessageKind;
  readonly recipientName: string;
  /** Отмечено «Отправил»: время отправки с сервера; строка контакта берёт его для метки «писали». */
  readonly onSent: (sentAt: string) => void;
  /** «Не отправлять»: родитель убирает панель. */
  readonly onClose: () => void;
}

type DraftState = ReturnType<typeof useContactMessage>;

function Notes({ state }: { readonly state: DraftState }) {
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
      {notice ? (
        <p className="row-sub" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}

function Actions({ state, onClose }: { readonly state: DraftState; readonly onClose: () => void }) {
  const { message, pending } = state;
  const approved = state.step === 'approved';
  return (
    <div className="actions">
      {approved ? (
        <Button variant="primary" icon="check" busy={pending} onClick={state.markSent}>
          Отправил
        </Button>
      ) : (
        <Button
          variant="primary"
          icon="check"
          disabled={!message || !state.text.trim() || state.variants.busy}
          busy={pending}
          onClick={state.approve}
        >
          Одобрить и отправить
        </Button>
      )}
      {message && !approved ? <VariantButton variants={state.variants} /> : null}
      <Button variant="quiet" onClick={onClose}>
        Не отправлять
      </Button>
    </div>
  );
}

/**
 * Панель черновика сообщения (a02d): текст правит и одобряет кандидат, платформа ничего не отправляет.
 * «Одобрить и отправить» копирует текст и открывает профиль получателя, «Отправил» отмечает отправку.
 *
 * @example
 * <MessageDraft target={{ contactId: person.id }} kind="known_contact" recipientName={person.name}
 *   onSent={(at) => markWritten(person.id, at)} onClose={() => setOpen(false)} />
 */
export function MessageDraft(props: MessageDraftProps) {
  // Другой получатель — другой черновик со своими вариантами.
  return <Draft key={JSON.stringify(props.target)} {...props} />;
}

function Draft({ target, kind, recipientName, onSent, onClose }: MessageDraftProps) {
  const fieldId = useId();
  const state = useContactMessage({ target, kind, recipientName, onSent });
  return (
    <div className="lk-inline" role="group" aria-labelledby={`${fieldId}-l`}>
      <div className="lk-dr-top">
        <label className="lk-lbl" id={`${fieldId}-l`} htmlFor={fieldId}>
          Черновик
        </label>
        {state.step === 'draft' ? (
          <VariantSwitch variants={state.variants} label="Варианты сообщения" />
        ) : null}
      </div>
      {state.message ? (
        <textarea
          className="lk-draft lk-edit"
          id={fieldId}
          rows={5}
          value={state.text}
          disabled={state.pending || state.variants.busy}
          onChange={(event) => state.setText(event.currentTarget.value)}
        />
      ) : null}
      <Notes state={state} />
      <Actions state={state} onClose={onClose} />
    </div>
  );
}
