import { useState } from 'react';
import type { FootprintReview } from '../../../../shared/candidateFootprint';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import { Button, Icon, Link, ResultLine, StatusLine, useToast } from '../kit';
import { buildNodePath } from '../routes';
import {
  addCandidateFootprintFindingToProfile,
  reviewCandidateFootprintFinding,
} from './footprintApi';
import { ACTION_ICON, confirmsOwner, levelTag, opensRemovalPath } from './footprintModel';
import { reportFailure } from './reportFailure';
import { announceFootprintChanged } from './useFootprint';

/** Отметка находки и отмена в тосте; после неё сводка перечитывается. */
export function useReview(onChanged: () => void) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(findingId: string, review: FootprintReview): Promise<boolean> {
    try {
      await reviewCandidateFootprintFinding(findingId, review);
      return true;
    } catch (reason) {
      reportFailure('отметка находки не сохранилась', reason);
      setError('Не удалось сохранить. Повторите.');
      return false;
    }
  }

  async function mark(findingId: string, review: 'hidden' | 'not_self', text: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await send(findingId, review);
    setBusy(false);
    if (!ok) return;
    onChanged();
    toast.show({
      text,
      undo: {
        label: 'Отменить',
        // Экран мог смениться: перечитывает тот, что открыт сейчас.
        onUndo: () => void send(findingId, 'unreviewed').then((done) => done && announceFootprintChanged()),
      },
    });
  }

  return { error, busy, mark };
}

function AddToProfile({ findingId }: { readonly findingId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  if (state === 'done') return <ResultLine text="Добавлено в профиль" />;

  async function add() {
    setState('busy');
    try {
      await addCandidateFootprintFindingToProfile(findingId);
      setState('done');
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

/** B727: страница найдена по нику — открыть её и сказать «не моё», если ник чужой. */
function OwnerActions({ item, onChanged }: { readonly item: FootprintRiskItem; readonly onChanged: () => void }) {
  const review = useReview(onChanged);
  const { findingId, url, action } = item;
  if (!url || !action) return null;
  return (
    <div className="fp-acts">
      <a className="btn is-sm" href={url} rel="noopener noreferrer" target="_blank"
        aria-label={`${action.label}: ${item.title}, откроется в новой вкладке`}>
        <Icon name={ACTION_ICON[action.kind]} />
        {action.label}
      </a>
      {findingId ? (
        <button className="row-act" type="button" disabled={review.busy}
          onClick={() => void review.mark(findingId, 'not_self', 'Отмечено: это не ваша страница')}>
          Это не моё
        </button>
      ) : null}
      {review.error ? <StatusLine state="err" text={review.error} /> : null}
    </div>
  );
}

function RowActions({ item, onChanged }: { readonly item: FootprintRiskItem; readonly onChanged: () => void }) {
  const review = useReview(onChanged);
  const { action, findingId } = item;
  if (!action) return null;
  if (confirmsOwner(item)) return <OwnerActions item={item} onChanged={onChanged} />;
  return (
    <div className="fp-acts">
      {action.kind === 'add_to_profile' && findingId ? <AddToProfile findingId={findingId} /> : null}
      {opensRemovalPath(item) ? (
        <Link className="btn is-sm" to={buildNodePath('f03b', { findingId: item.id })}>
          <Icon name={ACTION_ICON[action.kind]} />
          {action.label}
        </Link>
      ) : null}
      {findingId && action.kind !== 'add_to_profile' ? (
        <button className="row-act" type="button"
          onClick={() => void review.mark(findingId, 'hidden', 'Отмечено: не проблема')}>
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
