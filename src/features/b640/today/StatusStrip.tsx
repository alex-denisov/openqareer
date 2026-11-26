import { useState } from 'react';
import type { CandidateStatusToday } from '../../../../shared/candidateStatus';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, Icon, Link, ResultLine, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { revertStatus } from './statusApi';

export interface StatusStripProps {
  readonly status: CandidateStatusToday;
  /** Название статуса, к которому только что вернулись; `null` — возврата не было. */
  readonly revertedTitle: string | null;
  /** Статус вернули: экран запоминает название и перечитывает модули. */
  readonly onReverted: (title: string) => void;
  /** B650 s05b: «С 2 октября: 13 откликов → 1 интервью → 1 оффер»; `null` — откликов нет. */
  readonly funnel?: string | null;
  /** Макет s04: вопрос стоит над колонками — строки «Статус» нет, «Вернуть прежний» остаётся. */
  readonly withoutRow?: boolean;
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

function StatusRow({ title, funnel }: { readonly title: string; readonly funnel: string | null }) {
  return (
    <p className="s5-prog col-wide">
      <span>
        Статус: <strong>{title}</strong>
      </span>
      {funnel ? <span className="num">{funnel}</span> : null}
      <Link className="row-act is-sm" to={buildNodePath('s02')}>
        Сменить
      </Link>
    </p>
  );
}

/**
 * Строка статуса над «Сегодня». Сразу после смены — «Вернуть прежний»
 * (до конца дня), дальше — статус, путь откликов (s05b; без откликов строки нет) и «Сменить».
 */
export function StatusStrip({
  status,
  revertedTitle,
  onReverted,
  funnel = null,
  withoutRow = false,
}: StatusStripProps) {
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
      {withoutRow ? null : <StatusRow title={revertedTitle ?? status.title} funnel={funnel} />}
      {revertedTitle ? (
        <div className="col-wide">
          <ResultLine text={`Статус возвращён: ${revertedTitle}`} />
        </div>
      ) : null}
    </>
  );
}
