import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { CoachApiError } from '../../coach/apiClient';
import { getCandidateWithMessages } from '../../coach/candidateSnapshotApi';
import {
  changeMemory,
  sendCoachTurn,
  type CandidateMemory,
  type CoachTurnStage,
} from '../../coach/coachApi';
import { consultantTurns } from '../../journey/consultantHistory';
import { confirmFact, fetchCurrentConversation } from './consultantApi';
import { refusalOf, type ChatMessage, type TurnRefusal } from './model';
import type { ConsultantReplyExtras } from './replyModel';

interface PendingTurn {
  readonly idempotencyKey: string;
  readonly messageId: string;
  readonly content: string;
}

export type FactDecision =
  | { readonly action: 'confirm' | 'delete' }
  | { readonly action: 'correct'; readonly statement: string };

interface Feed {
  readonly messages: readonly ChatMessage[];
  readonly memory: readonly CandidateMemory[];
  /** Действия и ссылки под ответами консультанта. */
  readonly replies: readonly ConsultantReplyExtras[];
  /** Лента читается в первый раз. */
  readonly loading: boolean;
  readonly loadFailed: boolean;
  readonly reload: () => void;
  readonly decideFact: (id: string, decision: FactDecision) => Promise<void>;
}

interface FeedInternals extends Feed {
  readonly alive: RefObject<boolean>;
  /** Вопрос в пути: снимок, прочитанный до него, ленту не заменяет. */
  readonly asking: { current: boolean };
  readonly refresh: () => Promise<void>;
  readonly setMessages: Dispatch<SetStateAction<readonly ChatMessage[]>>;
  /** Тема, в которую идут вопросы: у продолжённого из истории разговора — своя. */
  readonly turnStage: CoachTurnStage;
}

interface Turns {
  /** Ответ пишется: текст на эту минуту, пустая строка — ещё ни слова. */
  readonly reply: string | null;
  /** Ответ не пришёл: вопрос остаётся в ленте, «Повторить» шлёт его же. */
  readonly sendFailed: boolean;
  /** Сервер отказал: сообщения по тарифу закончились. */
  readonly refused: TurnRefusal | null;
  /** Сколько ходов завершено: по нему перечитывается остаток квоты. */
  readonly turnCount: number;
  readonly send: (text: string) => void;
  readonly retry: () => void;
}

export type DialogState = Feed & Turns;

export function withFact(
  memory: readonly CandidateMemory[],
  id: string,
  decision: FactDecision,
): CandidateMemory[] {
  if (decision.action === 'delete') return memory.filter((item) => item.id !== id);
  return memory.map((item): CandidateMemory => {
    if (item.id !== id) return item;
    return decision.action === 'correct'
      ? { ...item, status: 'corrected', statement: decision.statement }
      : { ...item, status: 'confirmed' };
  });
}

/** «Верно» идёт через историю профиля (B688), правка и удаление — прежним путём. */
export async function sendFactDecision(id: string, decision: FactDecision): Promise<void> {
  if (decision.action === 'confirm') await confirmFact(id);
  else await changeMemory(id, decision);
}

/** Лента разговора и записи из него: первое чтение, повтор, решение по записи. */
function useFeed(stage: CoachTurnStage): FeedInternals {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [memory, setMemory] = useState<readonly CandidateMemory[]>([]);
  const [replies, setReplies] = useState<readonly ConsultantReplyExtras[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [turnStage, setTurnStage] = useState(stage);
  const alive = useRef(true);
  const asking = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const [snapshot, current] = await Promise.all([
      getCandidateWithMessages(stage),
      fetchCurrentConversation(stage),
    ]);
    if (!alive.current) return;
    if (!asking.current) setMessages(consultantTurns(current?.messages.map(chatMessage) ?? []));
    setTurnStage(current?.stage ?? stage);
    setReplies(current?.replies ?? []);
    setMemory(snapshot.memory);
  }, [stage]);

  useEffect(() => {
    let active = true;
    refresh()
      .then(() => active && setLoadFailed(false))
      .catch(() => active && setLoadFailed(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refresh, revision]);

  const decideFact = useCallback(async (id: string, decision: FactDecision) => {
    await sendFactDecision(id, decision);
    if (alive.current) setMemory((current) => withFact(current, id, decision));
  }, []);
  const reload = useCallback(() => {
    setLoading(true);
    setRevision((value) => value + 1);
  }, []);

  return {
    ...{ messages, memory, replies, loading, loadFailed, reload, decideFact },
    ...{ alive, asking, refresh, setMessages, turnStage },
  };
}

function chatMessage({ id, role, content }: ChatMessage): ChatMessage {
  return { id, role, content };
}

function newTurn(content: string): PendingTurn {
  return { idempotencyKey: crypto.randomUUID(), messageId: crypto.randomUUID(), content };
}

/** Отказ по тарифу; `null` — сбой другого рода. */
function refusalIn(error: unknown): TurnRefusal | null {
  const spent = error instanceof CoachApiError && error.code === 'quota_exhausted';
  return spent ? refusalOf(error.details) : null;
}

function answerOf(turn: PendingTurn, content: string): ChatMessage {
  return { id: `reply:${turn.idempotencyKey}`, role: 'assistant', content };
}

/**
 * Отправка вопроса: ответ по мере записи, сбой с повтором тем же ключом, отказ по тарифу.
 * После ответа снимок перечитывается: с ним приходят записи в профиль из этого хода.
 */
function useTurns(feed: FeedInternals): Turns {
  const { alive, asking, refresh, setMessages, turnStage: stage } = feed;
  const [reply, setReply] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [refused, setRefused] = useState<TurnRefusal | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const pending = useRef<PendingTurn | null>(null);

  const deliver = useCallback(
    async (turn: PendingTurn) => {
      if (asking.current) return;
      asking.current = true;
      setSendFailed(false);
      setReply('');
      try {
        const onMessageText = (text: string) => alive.current && setReply(text);
        const result = await sendCoachTurn({ ...turn, stage, onMessageText });
        if (!alive.current) return;
        pending.current = null;
        setMessages((current) => [...current, answerOf(turn, result.message)]);
        setTurnCount((count) => count + 1);
        void refresh().catch(() => undefined);
      } catch (error) {
        if (!alive.current) return;
        const refusal = refusalIn(error);
        if (refusal) pending.current = null;
        setRefused(refusal);
        setSendFailed(!refusal);
      } finally {
        asking.current = false;
        if (alive.current) setReply(null);
      }
    },
    [stage, alive, asking, refresh, setMessages],
  );

  const send = useCallback(
    (content: string) => {
      if (pending.current) return;
      const turn = newTurn(content);
      pending.current = turn;
      setMessages((current) => [...current, { id: turn.messageId, role: 'user', content }]);
      void deliver(turn);
    },
    [deliver, setMessages],
  );
  const retry = useCallback(() => {
    if (pending.current) void deliver(pending.current);
  }, [deliver]);

  return { reply, sendFailed, refused, turnCount, send, retry };
}

/** Текущий разговор по теме раздела: лента, отправка с ответом по мере записи, записи в профиль. */
export function useDialog(stage: CoachTurnStage): DialogState {
  const feed = useFeed(stage);
  const turns = useTurns(feed);
  const { messages, memory, replies, loading, loadFailed, reload, decideFact } = feed;
  return { messages, memory, replies, loading, loadFailed, reload, decideFact, ...turns };
}
