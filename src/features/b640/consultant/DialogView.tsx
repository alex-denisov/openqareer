import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateMemory, CoachTurnStage, CoachTurnSubject } from '../../coach/coachApi';
import { useTariffQuotas } from '../../tariffs/useTariffQuotas';
import { Composer } from '../kit/Composer';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import { FactCard } from './FactCard';
import {
  dayMarks,
  factsByMessage,
  limitOf,
  pendingLabel,
  proposedFacts,
  type ConsultantLimit,
} from './model';
import { ErrorRow, Message, Reply } from './parts';
import { FactCorrectionCard } from './FactCorrectionCard';
import { ResumeEditCard, type EditSource } from './ResumeEditCard';
import type { ConsultantReplyExtras } from './replyModel';
import { ReplyExtras } from './ReplyExtras';
import { useDialog, type DialogState, type FactDecision } from './useDialog';
import { useVoiceInput } from '../voice/useVoiceInput';

export interface DialogViewProps {
  readonly stage: CoachTurnStage;
  /** B746: объект открытого экрана (отклик, вакансия); вопросы уходят с ним. */
  readonly subject?: CoachTurnSubject;
  /** Факт, из которого готовая правка резюме (K6). */
  readonly resumeFactId?: string;
  readonly resumeReason?: string;
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

/** B786: правка K6 под ответом на просьбу кандидата поправить резюме. */
function AskedResumeEdit({
  extra,
  dialog,
}: {
  extra?: ConsultantReplyExtras;
  dialog: DialogState;
}) {
  const source: EditSource | null = extra?.resumeFactId
    ? { kind: 'fact', factId: extra.resumeFactId }
    : extra?.resumeRewordPlace
      ? { kind: 'reword', experienceId: extra.resumeRewordPlace }
      : null;
  if (!source) return null;
  return (
    <ResumeEditCard
      key={JSON.stringify(source)}
      source={source}
      memory={dialog.memory}
      messages={dialog.messages}
    />
  );
}

interface FeedProps {
  readonly dialog: DialogState;
  readonly placed: ReadonlyMap<string, readonly CandidateMemory[]>;
  readonly onDecide: (id: string, decision: FactDecision) => Promise<void>;
  readonly resumeFactId?: string;
  readonly resumeReason?: string;
}

function Feed({ dialog, placed, onDecide, resumeFactId, resumeReason }: FeedProps) {
  const extras = useMemo(
    () => new Map(dialog.replies.map((item) => [item.messageId, item])),
    [dialog.replies],
  );
  const days = useMemo(() => dayMarks(dialog.messages), [dialog.messages]);
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
            {days.has(message.id) ? <span className="day">{days.get(message.id)}</span> : null}
            <Message
              message={message}
              extra={extra ? <ReplyExtras extras={extra} memory={dialog.memory} /> : null}
            />
            {extra?.corrections?.map((proposal) => (
              <FactCorrectionCard key={proposal.before} proposal={proposal} />
            ))}
            {placed.get(message.id)?.map((fact) => (
              <FactCard key={fact.id} fact={fact} onDecide={onDecide} />
            ))}
            {resumeFactId ? null : <AskedResumeEdit extra={extra} dialog={dialog} />}
          </Fragment>
        );
      })}
      {resumeFactId ? (
        <ResumeEditCard
          source={{ kind: 'fact', factId: resumeFactId }}
          reason={resumeReason}
          memory={dialog.memory}
          messages={dialog.messages}
        />
      ) : null}
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
  const dictation = useVoiceInput(setText);
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
export function DialogView({
  stage,
  subject,
  resumeFactId,
  resumeReason,
  reviewPath,
  onReview,
  tariffsPath,
}: DialogViewProps) {
  const dialog = useDialog(stage, subject);
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
      <Feed
        dialog={dialog}
        placed={placed}
        onDecide={decide}
        resumeFactId={resumeFactId}
        resumeReason={resumeReason}
      />
      <Ask
        onSubmit={dialog.send}
        busy={dialog.reply !== null || dialog.sendFailed}
        limit={limitOf(quotas, dialog.refused)}
        tariffsPath={tariffsPath}
      />
    </>
  );
}
