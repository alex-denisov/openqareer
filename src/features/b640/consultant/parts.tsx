import type { ReactNode } from 'react';
import { ConsultantMessage } from '../../journey/ConsultantMessage';
import { Icon } from '../kit/Icon';
import './consultant.css';
import type { ChatMessage } from './model';

/** Ошибка на месте действия с «Повторить» (`p.res-row.is-err`). */
export function ErrorRow({
  text,
  onRetry,
  retryLabel = 'Повторить',
}: {
  readonly text: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}) {
  return (
    <p className="res-row is-err" role="alert">
      <Icon name="warn" />
      <span className="res-t">{text}</span>
      {onRetry ? (
        <button className="res-act" type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </p>
  );
}

/**
 * Реплика ленты: вопрос кандидата справа, ответ консультанта слева. Разметку ответа
 * (жирный, списки, абзацы) разбирает тот же разбор, что в прежнем кабинете: в React, без HTML.
 */
export function Message({
  message,
  extra,
}: {
  readonly message: ChatMessage;
  readonly extra?: ReactNode;
}) {
  if (message.role === 'user') return <p className="msg me">{message.content}</p>;
  return (
    <div className="msg bot">
      <ConsultantMessage text={message.content} />
      {extra}
    </div>
  );
}

/** Ответ пишется (K2): сначала «Консультант печатает», затем текст по мере записи. */
export function Reply({ text }: { readonly text: string }) {
  if (!text) {
    return (
      <p className="typing" role="status">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Консультант печатает
      </p>
    );
  }
  return (
    <div className="msg bot" aria-busy="true">
      <ConsultantMessage text={text} />
    </div>
  );
}
