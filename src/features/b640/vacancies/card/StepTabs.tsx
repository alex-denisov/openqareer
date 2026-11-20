import type { MouseEvent } from 'react';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';

export interface StepTabsProps {
  readonly vacancyId: string;
  /** Шаг «Отклик» открыт на карточке (a02d): «Вакансия» пройдена и возвращает к карточке. */
  readonly composing?: boolean;
  readonly onBack?: () => void;
}

/** Шаги отклика: «Вакансия», «Отклик», «Ответ»; текущий отмечен `aria-current`. */
export function StepTabs({ vacancyId, composing = false, onBack }: StepTabsProps) {
  const cardPath = buildNodePath('v04', { vacancyId });
  const back = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onBack) return;
    event.preventDefault();
    onBack();
  };
  return (
    <nav className="tabs sec-tabs r6-steps" aria-label="Шаги">
      <div className="sec-tabs-in">
        {composing ? (
          <Link to={cardPath} onClick={back}>
            <Icon name="check" />
            Вакансия
          </Link>
        ) : (
          <Link to={cardPath} aria-current="page">
            Вакансия
          </Link>
        )}
        {composing ? (
          <Link to={cardPath} aria-current="page" onClick={(event) => event.preventDefault()}>
            Отклик
          </Link>
        ) : (
          <Link to={buildNodePath('o02', { responseId: vacancyId })}>Отклик</Link>
        )}
        <Link to={buildNodePath('o01')}>Ответ</Link>
      </div>
    </nav>
  );
}
