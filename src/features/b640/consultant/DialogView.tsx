import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateMemory, CoachTurnStage } from '../../coach/coachApi';
import { useTariffQuotas } from '../../tariffs/useTariffQuotas';
import { Composer } from '../kit/Composer';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import { FactCard } from './FactCard';
import {
  factsByMessage,
  limitOf,
  pendingLabel,
  proposedFacts,
  type ConsultantLimit,
} from './model';
import { ErrorRow, Message, Reply } from './parts';
import { ReplyExtras } from './ReplyExtras';
import { useDialog, type DialogState, type FactDecision } from './useDialog';
import { useDictation } from './useDictation';

export interface DialogViewProps {
  readonly stage: CoachTurnStage;
  /** Записи на проверку открываются в этой же панели. */
  readonly reviewPath: string;
  readonly onReview: () => void;
  readonly tariffsPath: string;
}

interface PendingBannerProps {
  readonly count: number;
  readonly to: string;
  readonly onOpen: () => void;
}

/** Полоса «N записей ждут проверки»: ведёт к записям, где по каждой можно решить. */
export function PendingBanner({ count, to, onOpen }: PendingBannerProps) {
  return (
    <div className="ptop">
      <Link
        className="pend"
        to={to}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
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
  const extras = useMemo(
    () => new Map(dialog.replies.map((item) => [item.messageId, item])),
    [dialog.replies],
  );
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
      {dialog.messages.map((message) => {
        const extra = extras.get(message.id);
        return (
          <Fragment key={message.id}>
            <Message
              message={message}
              extra={extra ? <ReplyExtras extras={extra} memory={dialog.memory} /> : null}
            />
            {placed.get(message.id)?.map((fact) => (
              <FactCard key={fact.id} fact={fact} onDecide={onDecide} />
            ))}
          </Fragment>
        );
      })}
      {dialog.reply !== null ? <Reply text={dialog.reply} /> : null}
      {dialog.sendFailed ? <ErrorRow text="Ответ не пришёл" onRetry={dialog.retry} /> : null}
    </div>
  );
}

/** Строка закрытого ввода (K3): причина, дата новых сообщений и путь к тарифам. */
function LimitLine({ limit, tariffsPath }: { limit: ConsultantLimit; tariffsPath: string }) {
  return (
    <>
      <span className="cmp-line-t">
        Лимит сообщений исчерпан
        {limit.resetLabel ? (
          <>
            {' · '}
            <span className="cmp-line-d">
              обновится <span className="num">{limit.resetLabel}</span>
            </span>
          </>
        ) : null}
      </span>
      {limit.upgradePlan ? (
        <Link className="cmp-line-a" to={tariffsPath}>
          Перейти на {limit.upgradePlan}
        </Link>
      ) : null}
    </>
  );
}

interface AskProps {
  readonly onSubmit: (text: string) => void;
  /** Ответ ещё пишется или не пришёл: новая отправка ждёт, набранное остаётся в поле. */
  readonly busy: boolean;
  readonly limit: ConsultantLimit | null;
  readonly tariffsPath: string;
}

/** Ввод вопроса: текст или диктовка (K1b), предел сообщений (K3). */
function Ask({ onSubmit, busy, limit, tariffsPath }: AskProps) {
  const [text, setText] = useState('');
  const dictation = useDictation(setText);
  return (
    <Composer
      label="Ваш вопрос консультанту"
      placeholder="Спросите своими словами"
      onSubmit={onSubmit}
      busy={busy}
      text={text}
      onText={setText}
      dictation={dictation}
      closed={limit ? <LimitLine limit={limit} tariffsPath={tariffsPath} /> : null}
    />
  );
}

/** Разговор по теме раздела (макеты K1, K1b, K3, K7 и состояния K2, K3b, K4). */
export function DialogView({ stage, reviewPath, onReview, tariffsPath }: DialogViewProps) {
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
      {pending.length > 0 ? (
        <PendingBanner count={pending.length} to={reviewPath} onOpen={onReview} />
      ) : null}
      <Feed dialog={dialog} placed={placed} onDecide={decide} />
      <Ask
        onSubmit={dialog.send}
        busy={dialog.reply !== null || dialog.sendFailed}
        limit={limitOf(quotas, dialog.refused)}
        tariffsPath={tariffsPath}
      />
    </>
  );
}
