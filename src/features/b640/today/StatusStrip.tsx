import { useState } from 'react';
import type { CandidateStatusToday } from '../../../../shared/candidateStatus';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, Icon, Link, ResultLine, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { revertStatus } from './statusApi';

export interface StatusStripProps {
  readonly status: CandidateStatusToday;
  /** «13 откликов → 1 интервью → 1 оффер»; `null` — откликов ещё нет. */
  readonly progress: string | null;
  /** Название статуса, к которому только что вернулись; `null` — возврата не было. */
  readonly revertedTitle: string | null;
  /** Статус вернули: экран запоминает название и перечитывает модули. */
  readonly onReverted: (title: string) => void;
}

type RevertState =
  | { readonly step: 'idle' }
  | { readonly step: 'busy' }
  | { readonly step: 'error'; readonly message: string };

interface UndoStripProps {
  readonly title: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onRevert: () => void;
}

function UndoStrip({ title, busy, error, onRevert }: UndoStripProps) {
  return (
    <>
      <section className="undo col-wide" aria-label="Статус сменён">
        <Icon name="swap" />
        <p>
          Статус: <strong>{title}</strong>
        </p>
        <Button variant="quiet" size="sm" icon="undo" busy={busy} onClick={onRevert}>
          Вернуть прежний
        </Button>
      </section>
      {error ? (
        <div className="col-wide">
          <StatusLine state="err" text={error} />
        </div>
      ) : null}
    </>
  );
}

/**
 * Строка статуса над «Сегодня». Сразу после смены — «Вернуть прежний»
 * (до конца дня), дальше — статус, путь откликов и «Сменить».
 */
export function StatusStrip({ status, progress, revertedTitle, onReverted }: StatusStripProps) {
  const [revert, setRevert] = useState<RevertState>({ step: 'idle' });

  async function handleRevert() {
    setRevert({ step: 'busy' });
    try {
      const state = await revertStatus();
      setRevert({ step: 'idle' });
      onReverted(state.current.title);
    } catch (reason) {
      setRevert({
        step: 'error',
        message: apiErrorMessage(reason, 'Не удалось вернуть прежний статус.'),
      });
    }
  }

  if (status.revert && !revertedTitle) {
    return (
      <UndoStrip
        title={status.title}
        busy={revert.step === 'busy'}
        error={revert.step === 'error' ? revert.message : null}
        onRevert={() => void handleRevert()}
      />
    );
  }

  return (
    <>
      <p className="s5-prog col-wide">
        <span>
          Статус: <strong>{revertedTitle ?? status.title}</strong>
        </span>
        {progress ? <span className="num">{progress}</span> : null}
        <Link className="row-act is-sm" to={buildNodePath('s02')}>
          Сменить
        </Link>
      </p>
      {revertedTitle ? (
        <div className="col-wide">
          <ResultLine text={`Статус возвращён: ${revertedTitle}`} />
        </div>
      ) : null}
    </>
  );
}
