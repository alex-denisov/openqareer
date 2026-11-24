import { useRef } from 'react';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import type { Mark } from './useResponseActions';

export interface InterviewActionsProps {
  readonly responseId: string;
  /** Интервью ещё впереди: вход в подготовку (I1); иначе — в разбор (I4). */
  readonly ahead: boolean;
  /** «В архив» в «Другом способе» (макет o01c); остальные отметки — в «Отметить ответ». */
  readonly archive: Mark | undefined;
  readonly disabled: boolean;
  readonly onArchive: (target: Mark) => void;
}

/**
 * Действия раскрытого отклика на стадии интервью (O1c): до встречи — «Подготовиться к
 * интервью», после — «Разобрать запись» и «Другой способ» (файл, своими словами, «В архив»).
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

function OtherWays({ responseId, archive, disabled, onArchive }: InterviewActionsProps) {
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
        {archive ? (
          <li>
            <button
              className="row-act"
              type="button"
              disabled={disabled}
              onClick={() => {
                if (ref.current) ref.current.open = false;
                onArchive(archive);
              }}
            >
              <Icon name="down" />
              {archive.label}
            </button>
          </li>
        ) : null}
      </ul>
    </details>
  );
}
