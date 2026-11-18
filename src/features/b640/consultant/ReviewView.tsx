import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCandidate } from '../../coach/candidateSnapshotApi';
import type { CandidateMemory } from '../../coach/coachApi';
import { Button } from '../kit/Button';
import { FactCard } from './FactCard';
import { proposedFacts } from './model';
import { ErrorRow } from './parts';
import { sendFactDecision, withFact, type FactDecision } from './useDialog';

type Load = 'loading' | 'ready' | 'failed';

/** Записи, ждущие решения, из снимка кандидата; решённые остаются с итогом на месте. */
function useReview() {
  const [memory, setMemory] = useState<readonly CandidateMemory[]>([]);
  const [shownIds, setShownIds] = useState<readonly string[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getCandidate()
      .then((snapshot) => {
        if (!active) return;
        setMemory(snapshot.memory);
        setShownIds(proposedFacts(snapshot.memory).map((item) => item.id));
        setLoad('ready');
      })
      .catch(() => active && setLoad('failed'));
    return () => {
      active = false;
    };
  }, [revision]);

  const decide = useCallback(async (id: string, decision: FactDecision) => {
    await sendFactDecision(id, decision);
    setMemory((current) => withFact(current, id, decision));
  }, []);
  const retry = useCallback(() => {
    setLoad('loading');
    setRevision((value) => value + 1);
  }, []);
  const facts = useMemo(() => {
    const byId = new Map(memory.map((item) => [item.id, item]));
    return shownIds.flatMap((id) => byId.get(id) ?? []);
  }, [memory, shownIds]);
  return { facts, load, decide, retry };
}

const PAGE = 20;

interface ReviewListProps {
  readonly facts: readonly CandidateMemory[];
  readonly onDecide: (id: string, decision: FactDecision) => Promise<void>;
}

/** Карточки по 20 и «Показать ещё»; карточка — не строка списка, у неё три действия. */
function ReviewList({ facts, onDecide }: ReviewListProps) {
  const [shown, setShown] = useState(PAGE);
  const visible = facts.slice(0, shown);
  const left = facts.length - visible.length;
  return (
    <>
      <div className="rv-list">
        {visible.map((fact) => (
          <FactCard key={fact.id} fact={fact} onDecide={onDecide} />
        ))}
      </div>
      {facts.length > PAGE ? (
        <div className="vl-foot ct-foot">
          <span className="ct-count num">{`${visible.length} из ${facts.length}`}</span>
          {left > 0 ? (
            <Button icon="down" onClick={() => setShown((value) => value + PAGE)}>
              <span>{`Показать ещё ${Math.min(PAGE, left)}`}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Записи на проверку из всех разговоров (B688): у каждой «Верно», «Исправить», «Не нужно».
 * Порциями по 20.
 */
export function ReviewView() {
  const review = useReview();
  return (
    <div className="chat" aria-busy={review.load === 'loading'}>
      {review.load === 'failed' ? (
        <ErrorRow text="Записи не загрузились" onRetry={review.retry} />
      ) : null}
      {review.load === 'ready' && review.facts.length === 0 ? (
        <p className="mod-text">Все записи проверены</p>
      ) : null}
      {review.facts.length > 0 ? (
        <ReviewList facts={review.facts} onDecide={review.decide} />
      ) : null}
    </div>
  );
}
