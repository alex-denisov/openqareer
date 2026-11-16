import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateMemory, CoachTurnStage } from '../../coach/coachApi';
import { useTariffQuotas } from '../../tariffs/useTariffQuotas';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import { ConsultantComposer } from './ConsultantComposer';
import { FactCard } from './FactCard';
import { factsByMessage, limitOf, pendingLabel, proposedFacts } from './model';
import { ErrorRow, Message, Reply } from './parts';
import { useDialog, type DialogState, type FactDecision } from './useDialog';

export interface DialogViewProps {
  readonly stage: CoachTurnStage;
  readonly reviewPath: string;
  readonly tariffsPath: string;
}

function PendingBanner({ count, to }: { readonly count: number; readonly to: string }) {
  return (
    <div className="ptop">
      <Link className="pend" to={to}>
        <Icon name="checkc" />
        <span>
          <b>{pendingLabel(count)}</b>
        </span>
        <Icon name="arrow" className="ico end" />
      </Link>
    </div>
  );
}

interface FeedProps {
  readonly dialog: DialogState;
  readonly placed: ReadonlyMap<string, readonly CandidateMemory[]>;
  readonly onDecide: (id: string, decision: FactDecision) => Promise<void>;
}

function Feed({ dialog, placed, onDecide }: FeedProps) {
  const chat = useRef<HTMLDivElement>(null);
  const lastId = dialog.messages[dialog.messages.length - 1]?.id;
  useEffect(() => {
    const node = chat.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lastId, dialog.reply, dialog.sendFailed]);
  return (
    <div className="chat" aria-live="polite" aria-busy={dialog.loading} ref={chat}>
      {dialog.loadFailed ? (
        <ErrorRow text="Разговор не загрузился" onRetry={dialog.reload} />
      ) : null}
      {dialog.messages.map((message) => (
        <Fragment key={message.id}>
          <Message message={message} />
          {placed.get(message.id)?.map((fact) => (
            <FactCard key={fact.id} fact={fact} onDecide={onDecide} />
          ))}
        </Fragment>
      ))}
      {dialog.reply !== null ? <Reply text={dialog.reply} /> : null}
      {dialog.sendFailed ? <ErrorRow text="Ответ не пришёл" onRetry={dialog.retry} /> : null}
    </div>
  );
}

/** Разговор по теме раздела (макеты K1, K1b, K3, K7 и состояния K2, K3b, K4). */
export function DialogView({ stage, reviewPath, tariffsPath }: DialogViewProps) {
  const dialog = useDialog(stage);
  const quotas = useTariffQuotas(dialog.turnCount);
  // Записи, по которым решение принято здесь: их итог остаётся в ленте.
  const [decided, setDecided] = useState<readonly string[]>([]);
  const pending = useMemo(() => proposedFacts(dialog.memory), [dialog.memory]);
  const placed = useMemo(() => {
    const shown = dialog.memory.filter(
      (item) => pending.includes(item) || decided.includes(item.id),
    );
    return factsByMessage(dialog.messages, shown);
  }, [dialog.memory, dialog.messages, pending, decided]);

  async function decide(id: string, decision: FactDecision) {
    await dialog.decideFact(id, decision);
    if (decision.action !== 'delete') setDecided((current) => [...current, id]);
  }

  return (
    <>
      {pending.length > 0 ? <PendingBanner count={pending.length} to={reviewPath} /> : null}
      <Feed dialog={dialog} placed={placed} onDecide={decide} />
      <ConsultantComposer
        onSubmit={dialog.send}
        busy={dialog.reply !== null || dialog.sendFailed}
        limit={limitOf(quotas, dialog.refused)}
        tariffsPath={tariffsPath}
      />
    </>
  );
}
