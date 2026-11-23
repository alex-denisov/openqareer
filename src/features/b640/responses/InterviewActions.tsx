import { useRef } from 'react';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import type { Mark } from './useResponseActions';

export interface InterviewActionsProps {
  readonly responseId: string;
  /** Интервью ещё впереди: вход в подготовку (I1); иначе — в разбор (I4). */
  readonly ahead: boolean;
  /** Отметки ответа после интервью: в макете o01c они в «Другом способе». */
  readonly marks: readonly Mark[];
  readonly disabled: boolean;
  readonly onMark: (target: Mark) => void;
}

/**
 * Действия раскрытого отклика на стадии интервью (O1c): до встречи — «Подготовиться к
 * интервью», после — «Разобрать запись» и «Другой способ» (файл, своими словами, отметки).
 */
export function InterviewActions(props: InterviewActionsProps) {
  const { responseId, ahead } = props;
  if (ahead) {
    return (
      <Link className="btn is-primary" to={buildNodePath('i01', { responseId })}>
        <Icon name="checkc" />
        Подготовиться к интервью
      </Link>
    );
  }
  return (
    <>
      <Link className="btn is-primary" to={buildNodePath('i04', { responseId })}>
        <Icon name="play" />
        Разобрать запись
      </Link>
      <OtherWays {...props} />
    </>
  );
}

function OtherWays({ responseId, marks, disabled, onMark }: InterviewActionsProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const debrief = buildNodePath('i04', { responseId });
  return (
    <details className="ways" ref={ref}>
      <summary className="btn">
        <Icon name="more" />
        Другой способ
      </summary>
      <ul className="ways-list">
        <li>
          <Link className="row-act" to={buildNodePath('i04c', { responseId })}>
            <Icon name="upload" />
            Загрузить файл
          </Link>
        </li>
        <li>
          <Link className="row-act" to={`${debrief}#own`}>
            <Icon name="mic" />
            Рассказать своими словами
          </Link>
        </li>
        {marks.map((target) => (
          <li key={target.stage}>
            <button
              className="row-act"
              type="button"
              disabled={disabled}
              onClick={() => {
                if (ref.current) ref.current.open = false;
                onMark(target);
              }}
            >
              {target.stage === 'archived' ? <Icon name="down" /> : null}
              {target.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
