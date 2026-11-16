import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CoachTurnStage } from '../../coach/coachApi';
import { useTariffQuotas } from '../../tariffs/useTariffQuotas';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import { ConsultantComposer } from './ConsultantComposer';
import { FactCard } from './FactCard';
import { factsByMessage, limitOf, pendingLabel, proposedFacts, type ChatMessage } from './model';
import { useDialog, type FactDecision } from './useDialog';

export interface DialogViewProps {
  readonly stage: CoachTurnStage;
  readonly reviewPath: string;
  readonly tariffsPath: string;
}

function Paragraphs({ text }: { readonly text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/u)
        .filter((part) => part.trim())
        .map((part, index) => (
          <p key={index}>{part.trim()}</p>
        ))}
    </>
  );
}

/** Реплика ленты: вопрос кандидата справа, ответ консультанта слева. */
export function Message({ message }: { readonly message: ChatMessage }) {
  if (message.role === 'user') return <p className="msg me">{message.content}</p>;
  return (
    <div className="msg bot">
      <Paragraphs text={message.content} />
    </div>
  );
}

/** Ответ пишется (K2): сначала «Консультант печатает», затем текст по мере записи. */
function Reply({ text }: { readonly text: string }) {
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
      <p>
        {text}
        <span className="caret" aria-hidden="true" />
      </p>
    </div>
  );
}

function ErrorRow({ text, onRetry }: { readonly text: string; readonly onRetry: () => void }) {
  return (
    <p className="res-row is-err" role="alert">
      <Icon name="warn" />
      <span className="res-t">{text}</span>
      <button className="res-act" type="button" onClick={onRetry}>
        Повторить
      </button>
    </p>
  );
}

/** Разговор по теме раздела (макеты K1, K1b, K3, K7 и состояния K2, K3b, K4). */
export function DialogView({ stage, reviewPath, tariffsPath }: DialogViewProps) {
  const dialog = useDialog(stage);
  const quotas = useTariffQuotas(dialog.turnCount);
  const chat = useRef<HTMLDivElement>(null);
  // Записи, по которым решение принято здесь: их итог остаётся в ленте.
  const [decided, setDecided] = useState<readonly string[]>([]);

  const pending = useMemo(() => proposedFacts(dialog.memory), [dialog.memory]);
  const placed = useMemo(() => {
    const shown = dialog.memory.filter(
      (item) => pending.includes(item) || decided.includes(item.id),
    );
    return factsByMessage(dialog.messages, shown);
  }, [dialog.memory, dialog.messages, pending, decided]);

  const lastId = dialog.messages[dialog.messages.length - 1]?.id;
  useEffect(() => {
    const node = chat.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lastId, dialog.reply, dialog.sendFailed]);

  async function decide(id: string, decision: FactDecision) {
    await dialog.decideFact(id, decision);
    if (decision.action !== 'delete') setDecided((current) => [...current, id]);
  }

  return (
    <>
      {pending.length > 0 ? (
        <div className="ptop">
          <Link className="pend" to={reviewPath}>
            <Icon name="checkc" />
            <span>
              <b>{pendingLabel(pending.length)}</b>
            </span>
            <Icon name="arrow" className="ico end" />
          </Link>
        </div>
      ) : null}
      <div className="chat" aria-live="polite" aria-busy={dialog.loading} ref={chat}>
        {dialog.loadFailed ? (
          <ErrorRow text="Разговор не загрузился" onRetry={dialog.reload} />
        ) : null}
        {dialog.messages.map((message) => (
          <Fragment key={message.id}>
            <Message message={message} />
            {placed.get(message.id)?.map((fact) => (
              <FactCard key={fact.id} fact={fact} onDecide={decide} />
            ))}
          </Fragment>
        ))}
        {dialog.reply !== null ? <Reply text={dialog.reply} /> : null}
        {dialog.sendFailed ? <ErrorRow text="Ответ не пришёл" onRetry={dialog.retry} /> : null}
      </div>
      <ConsultantComposer
        onSubmit={dialog.send}
        busy={dialog.reply !== null || dialog.sendFailed}
        limit={limitOf(quotas, dialog.refused)}
        tariffsPath={tariffsPath}
      />
    </>
  );
}
