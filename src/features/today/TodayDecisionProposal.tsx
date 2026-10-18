import './today-decision-proposal.css';
import { useEffect, useRef, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import {
  getTodaySnapshot,
  selectTodayDecision,
  type TodayQueueItem,
  type TodaySnapshot,
} from './todayApi';
import { queueActionTitle } from './todayFormat';

/** A suggestion is grounded in the candidate's current follow-up queue, never in demo copy. */
function useTodayDecisionProposal() {
  const [today, setToday] = useState<TodaySnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void getTodaySnapshot(Intl.DateTimeFormat().resolvedOptions().timeZone, controller.signal)
      .then(setToday)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const item = today?.queue.find((entry) => entry.kind === 'follow_up' && entry.applicationId);
  const applicationId = item?.applicationId;
  async function resolve(resolution: 'accepted' | 'dismissed') {
    if (inFlight.current || !applicationId) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const todayDecisionSelection = await selectTodayDecision(applicationId, resolution);
      setToday((current) => (current ? { ...current, todayDecisionSelection } : current));
    } catch {
      setError('Не удалось сохранить решение. Попробуйте ещё раз.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return {
    item: today?.todayDecisionSelection?.applicationId === applicationId ? undefined : item,
    busy,
    error,
    resolve,
  };
}

export function TodayDecisionProposal({
  onAvailabilityChange,
}: {
  readonly onAvailabilityChange: (count: number) => void;
}) {
  const { item, busy, error, resolve } = useTodayDecisionProposal();
  useEffect(() => {
    onAvailabilityChange(item?.applicationId ? 1 : 0);
    return () => onAvailabilityChange(0);
  }, [item?.applicationId, onAvailabilityChange]);
  if (!item?.applicationId) return null;
  return (
    <section className="career-expert-proposal" aria-label="Заменить решение дня" aria-busy={busy}>
      <p className="career-expert-proposal-title">Заменить решение дня</p>
      <p>
        {queueActionTitle(item)}. {proposalReason(item)}
      </p>
      <div className="career-expert-actions">
        <button
          type="button"
          className="career-quiet-button career-inline-ok"
          disabled={busy}
          onClick={() => void resolve('accepted')}
        >
          <Check size={16} aria-hidden="true" />
          Принять
        </button>
        <button
          type="button"
          className="career-quiet-button"
          disabled={busy}
          onClick={() => void resolve('dismissed')}
        >
          <X size={16} aria-hidden="true" />
          Отклонить
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

/** Почему замена: для просроченного напоминания — так, как в макете. */
function proposalReason(item: TodayQueueItem): string {
  if (item.kind === 'follow_up' && item.dueAt && Date.parse(item.dueAt) < Date.now())
    return 'Срок ответа уже прошёл.';
  const detail = item.eyebrow?.trim();
  if (!detail) return 'Задача из вашей очереди дня.';
  return `${detail.charAt(0).toLocaleUpperCase('ru-RU')}${detail.slice(1)}.`;
}
