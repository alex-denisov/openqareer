import { pressApply } from '../../apply/applyIntent';
import type { ReactNode } from 'react';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { AppliedLink } from './AppliedLink';
import { SaveButton, type SaveButtonProps } from './SaveButton';

export interface ActBarProps {
  readonly vacancyId: string;
  /** Отклик по вакансии уже отправлен: вместо «Откликнуться» — он. */
  readonly responseId?: string | undefined;
  /** Профиля нет: главная кнопка — «Добавить опыт», «Откликнуться» обычная. */
  readonly noProfile: boolean;
  readonly save: Omit<SaveButtonProps, 'mobile'> | null;
}

function applyLink({ vacancyId, responseId }: ActBarProps, primary: boolean): ReactNode {
  if (responseId) {
    return <AppliedLink responseId={responseId} className={primary ? 'btn is-primary' : 'btn'} />;
  }
  return (
    <Link className={primary ? 'btn is-primary' : 'btn'} to={buildNodePath('o02', { responseId: vacancyId })} onClick={() => pressApply(vacancyId)}>
      <Icon name="responses" />
      Откликнуться
    </Link>
  );
}

/** Действия: «Откликнуться» (на 390 закреплена внизу) и «Сохранить». */
export function ActBar(props: ActBarProps) {
  const { noProfile, save } = props;
  const addExperience = (
    <Link className="btn is-primary" to={buildNodePath('p04')}>
      <Icon name="plus" />
      Добавить опыт
    </Link>
  );
  return (
    <div className="v4-act">
      <div className="actions v4-act-main">
        {noProfile ? addExperience : applyLink(props, true)}
      </div>
      {noProfile ? applyLink(props, false) : null}
      {save ? <SaveButton {...save} /> : null}
    </div>
  );
}
