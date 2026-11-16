import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface ResultLineProps {
  readonly text: string;
  /** Есть — рядом кнопка «Отменить». */
  readonly onUndo?: () => void;
  readonly undoLabel?: string;
}

/** Результат на месте действия: `p.res-row[role=status]`, высота ≤ 40 px. */
export function ResultLine({ text, onUndo, undoLabel = 'Отменить' }: ResultLineProps) {
  return (
    <p className="res-row" role="status">
      <Icon name="check" />
      <span className="res-t">{text}</span>
      {onUndo ? (
        <button className="res-act" type="button" onClick={onUndo}>
          {undoLabel}
        </button>
      ) : null}
    </p>
  );
}

export type StatusState = 'wait' | 'ok' | 'err';

export interface StatusLineProps {
  readonly state: StatusState;
  readonly text: string;
  /** Кнопка или ссылка справа: «Повторить», «Войти». */
  readonly action?: ReactNode;
}

const STATUS_ICON = { wait: 'clock', ok: 'checkc', err: 'warn' } as const;

/** `p.re-line`: ожидание, успех, ошибка (у ошибки `role=alert`). */
export function StatusLine({ state, text, action }: StatusLineProps) {
  const className = state === 'wait' ? 're-line' : `re-line is-${state}`;
  const live =
    state === 'err'
      ? { role: 'alert' as const }
      : { role: 'status' as const, 'aria-live': 'polite' as const };
  return (
    <p className={className} {...live}>
      <Icon name={STATUS_ICON[state]} />
      <span>{text}</span>
      {action}
    </p>
  );
}
