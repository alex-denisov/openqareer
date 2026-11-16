import { useCallback, useEffect, useRef, useState } from 'react';
import { CoachApiError } from '../../coach/apiClient';
import { getCandidateWithMessages } from '../../coach/candidateSnapshotApi';
import {
  changeMemory,
  sendCoachTurn,
  type CandidateMemory,
  type CoachTurnStage,
} from '../../coach/coachApi';
import { consultantTurns } from '../../journey/consultantHistory';
import type { ChatMessage } from './model';

interface PendingTurn {
  readonly idempotencyKey: string;
  readonly messageId: string;
  readonly content: string;
}

export type FactDecision =
  | { readonly action: 'confirm' | 'delete' }
  | { readonly action: 'correct'; readonly statement: string };

export interface DialogState {
  readonly messages: readonly ChatMessage[];
  readonly memory: readonly CandidateMemory[];
  /** Лента читается в первый раз. */
  readonly loading: boolean;
  readonly loadFailed: boolean;
  /** Ответ пишется: текст на эту минуту, пустая строка — ещё ни слова. */
  readonly reply: string | null;
  /** Ответ не пришёл: вопрос остаётся в ленте, «Повторить» шлёт его же. */
  readonly sendFailed: boolean;
  /** Сервер отказал: сообщения по тарифу закончились. */
  readonly refused: boolean;
  /** Сколько ходов завершено: по нему перечитывается остаток квоты. */
  readonly turnCount: number;
  readonly reload: () => void;
  readonly send: (text: string) => void;
  readonly retry: () => void;
  readonly decideFact: (id: string, decision: FactDecision) => Promise<void>;
}

function withFact(
  memory: readonly CandidateMemory[],
  id: string,
  decision: FactDecision,
): CandidateMemory[] {
  if (decision.action === 'delete') return memory.filter((item) => item.id !== id);
  return memory.map((item) => {
    if (item.id !== id) return item;
    return decision.action === 'confirm'
      ? { ...item, status: 'confirmed' }
      : { ...item, status: 'corrected', statement: decision.statement };
  });
}

/** Текущий разговор по теме раздела: лента, отправка с ответом по мере записи, записи в профиль. */
export function useDialog(stage: CoachTurnStage): DialogState {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [memory, setMemory] = useState<readonly CandidateMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [refused, setRefused] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [loadRevision, setLoadRevision] = useState(0);
  const pending = useRef<PendingTurn | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = await getCandidateWithMessages(stage);
    if (!alive.current) return;
    setMessages(consultantTurns(snapshot.messages));
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
  }, [refresh, loadRevision]);

  const deliver = useCallback(
    async (turn: PendingTurn) => {
      setSendFailed(false);
      setReply('');
      try {
        const result = await sendCoachTurn({
          content: turn.content,
          idempotencyKey: turn.idempotencyKey,
          messageId: turn.messageId,
          stage,
          onMessageText: (text) => alive.current && setReply(text),
        });
        if (!alive.current) return;
        pending.current = null;
        setMessages((current) => [
          ...current,
          { id: `reply:${turn.idempotencyKey}`, role: 'assistant', content: result.message },
        ]);
        setTurnCount((count) => count + 1);
        // Записи в профиль из этого хода приходят со снимком; сбой чтения ленту не портит.
        void refresh().catch(() => undefined);
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof CoachApiError && error.code === 'quota_exhausted') {
          pending.current = null;
          setRefused(true);
        } else {
          setSendFailed(true);
        }
      } finally {
        if (alive.current) setReply(null);
      }
    },
    [stage, refresh],
  );

  const send = useCallback(
    (text: string) => {
      if (pending.current) return;
      const turn: PendingTurn = {
        idempotencyKey: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        content: text,
      };
      pending.current = turn;
      setMessages((current) => [...current, { id: turn.messageId, role: 'user', content: text }]);
      void deliver(turn);
    },
    [deliver],
  );

  const retry = useCallback(() => {
    if (pending.current) void deliver(pending.current);
  }, [deliver]);

  const decideFact = useCallback(async (id: string, decision: FactDecision) => {
    await changeMemory(id, decision);
    if (alive.current) setMemory((current) => withFact(current, id, decision));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadRevision((revision) => revision + 1);
  }, []);

  return {
    messages,
    memory,
    loading,
    loadFailed,
    reply,
    sendFailed,
    refused,
    turnCount,
    reload,
    send,
    retry,
    decideFact,
  };
}
