import { useState } from 'react';
import type { FootprintReview } from '../../../../shared/candidateFootprint';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import { Button, Icon, Link, ResultLine, StatusLine, useToast } from '../kit';
import { buildNodePath } from '../routes';
import {
  addFindingToProfile,
  removeFindingFromProfile,
  reviewCandidateFootprintFinding,
  reviewFootprintMismatch,
} from './footprintApi';
import { ACTION_ICON, confirmsOwner, levelTag, opensRemovalPath } from './footprintModel';
import { reportFailure } from './reportFailure';
import { announceFootprintChanged } from './useFootprint';

/** Что отмечаем: находку следа или расхождение с резюме (B645 p02). */
export interface ReviewTarget {
  readonly kind: 'finding' | 'mismatch';
  readonly id: string;
}

/** Расхождение отмечается само, а не находка, к которой оно привязано. */
export function reviewTarget(item: FootprintRiskItem): ReviewTarget | null {
  if (item.mismatch) return { kind: 'mismatch', id: item.id };
  return item.findingId ? { kind: 'finding', id: item.findingId } : null;
}

/** Отметка находки и отмена в тосте; после неё сводка перечитывается. */
export function useReview(onChanged: () => void) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(target: ReviewTarget, review: FootprintReview): Promise<boolean> {
    try {
      if (target.kind === 'mismatch') {
        await reviewFootprintMismatch(target.id, review === 'unreviewed' ? 'unreviewed' : 'hidden');
      } else {
        await reviewCandidateFootprintFinding(target.id, review);
      }
      return true;
    } catch (reason) {
      reportFailure('отметка находки не сохранилась', reason);
      setError('Не удалось сохранить. Повторите.');
      return false;
    }
  }

  async function mark(
    target: ReviewTarget,
    review: 'hidden' | 'not_self' | 'confirmed_self',
    text: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await send(target, review);
    setBusy(false);
    if (!ok) return;
    onChanged();
    toast.show({
      text,
      undo: {
        label: 'Отменить',
        // Экран мог смениться: перечитывает тот, что открыт сейчас.
        onUndo: () => void send(target, 'unreviewed').then((done) => done && announceFootprintChanged()),
      },
    });
  }

  /** «Это моё»: находка подтверждена, «Отменить» вернёт её в неразобранные. */
  function confirm(target: ReviewTarget, text: string) {
    return mark(target, 'confirmed_self', text);
  }

  return { error, busy, mark, confirm };
}

/** «В профиль» с отменой в тосте; тот же факт уже в профиле — «Уже в профиле» (B382). */
function AddToProfile({ findingId }: { readonly findingId: string }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'already' | 'error'>('idle');
  if (state === 'done') return <ResultLine text="Добавлено в профиль" />;
  if (state === 'already') return <ResultLine text="Уже в профиле" />;

  async function undo() {
    try {
      await removeFindingFromProfile(findingId);
      setState('idle');
      announceFootprintChanged();
    } catch (reason) {
      reportFailure('находка не убрана из профиля', reason);
    }
  }

  async function add() {
    setState('busy');
    try {
      const { alreadyInProfile } = await addFindingToProfile(findingId);
      setState(alreadyInProfile ? 'already' : 'done');
      if (!alreadyInProfile) {
        toast.show({ text: 'Добавлено в профиль', undo: { label: 'Отменить', onUndo: () => void undo() } });
      }
    } catch (reason) {
      reportFailure('находка не добавилась в профиль', reason);
      setState('error');
    }
  }

  return (
    <>
      <Button variant="quiet" size="sm" icon="plus" busy={state === 'busy'} onClick={() => void add()}>
        В профиль
      </Button>
      {state === 'error' ? <StatusLine state="err" text="Не удалось добавить. Повторите." /> : null}
    </>
  );
}

/** «Это не моё» у находки: страница чужая — уходит из сводки, в тосте «Отменить». */
function NotMine({ item, onChanged }: { readonly item: FootprintRiskItem; readonly onChanged: () => void }) {
  const review = useReview(onChanged);
  const { findingId } = item;
  if (!findingId) return null;
  return (
    <>
      <button className="row-act" type="button" disabled={review.busy}
        onClick={() => void review.mark({ kind: 'finding', id: findingId }, 'not_self', 'Отмечено: это не ваша страница')}>
        Это не моё
      </button>
      {review.error ? <StatusLine state="err" text={review.error} /> : null}
    </>
  );
}

/** B727/B382: страница по нику — «Проверить» ведёт на f03b, сама страница открывается там. */
function OwnerActions({ item, onChanged }: { readonly item: FootprintRiskItem; readonly onChanged: () => void }) {
  const { action } = item;
  if (!action) return null;
  return (
    <div className="fp-acts">
      <Link className="btn is-sm" to={buildNodePath('f03b', { findingId: item.id })}>
        <Icon name={ACTION_ICON[action.kind]} />
        {action.label}
      </Link>
      <NotMine item={item} onChanged={onChanged} />
    </div>
  );
}

function RowActions({ item, onChanged }: { readonly item: FootprintRiskItem; readonly onChanged: () => void }) {
  const review = useReview(onChanged);
  const { action, findingId } = item;
  if (!action) return null;
  if (confirmsOwner(item)) return <OwnerActions item={item} onChanged={onChanged} />;
  if (action.kind === 'not_mine') {
    return (
      <div className="fp-acts">
        <NotMine item={item} onChanged={onChanged} />
      </div>
    );
  }
  const target = reviewTarget(item);
  return (
    <div className="fp-acts">
      {action.kind === 'add_to_profile' && findingId ? <AddToProfile findingId={findingId} /> : null}
      {opensRemovalPath(item) ? (
        <Link className="btn is-sm" to={buildNodePath('f03b', { findingId: item.id })}>
          <Icon name={ACTION_ICON[action.kind]} />
          {action.label}
        </Link>
      ) : null}
      {target && opensRemovalPath(item) ? (
        <button className="row-act" type="button"
          onClick={() => void review.mark(target, 'hidden', 'Отмечено: не проблема')}>
          Это не проблема
        </button>
      ) : null}
      {review.error ? <StatusLine state="err" text={review.error} /> : null}
    </div>
  );
}

interface FindingRowProps {
  readonly item: FootprintRiskItem;
  /** P2 показывает уровень у каждой находки; в сводке F3 он стоит у категории. */
  readonly showLevel?: boolean;
  readonly onChanged: () => void;
}

export function FindingRow({ item, showLevel = false, onChanged }: FindingRowProps) {
  return (
    <li className="row fp-find">
      <div>
        <div className="row-title">{item.title}</div>
        {item.detail ? <div className="row-sub">{item.detail}</div> : null}
        {showLevel ? (
          <div className="fp-risk">
            <span className={item.resolved ? 'tag ok' : levelTag(item.level)}>
              {item.resolved ? 'разобрано' : item.levelLabel}
            </span>
          </div>
        ) : null}
        <RowActions item={item} onChanged={onChanged} />
      </div>
    </li>
  );
}
