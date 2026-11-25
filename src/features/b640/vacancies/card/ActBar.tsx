import { pressApply } from '../../apply/applyIntent';
import type { ReactNode } from 'react';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { SaveButton, type SaveButtonProps } from './SaveButton';

export interface ActBarProps {
  readonly vacancyId: string;
  /** Профиля нет: главная кнопка — «Добавить опыт», «Откликнуться» обычная. */
  readonly noProfile: boolean;
  readonly save: Omit<SaveButtonProps, 'mobile'> | null;
  readonly onOpenText: () => void;
}

function applyLink(vacancyId: string, primary: boolean): ReactNode {
  return (
    <Link className={primary ? 'btn is-primary' : 'btn'} to={buildNodePath('o02', { responseId: vacancyId })} onClick={() => pressApply(vacancyId)}>
      <Icon name="responses" />
      Откликнуться
    </Link>
  );
}

/** Действия: «Откликнуться» (на 390 закреплена внизу), «Текст вакансии», «Сохранить». */
export function ActBar({ vacancyId, noProfile, save, onOpenText }: ActBarProps) {
  const addExperience = (
    <Link className="btn is-primary" to={buildNodePath('p04')}>
      <Icon name="plus" />
      Добавить опыт
    </Link>
  );
  return (
    <div className="v4-act">
      <div className="actions v4-act-main">
        {noProfile ? addExperience : applyLink(vacancyId, true)}
      </div>
      {noProfile ? applyLink(vacancyId, false) : null}
      <button className="btn v4-text" type="button" onClick={onOpenText}>
        <Icon name="file" />
        Текст вакансии
      </button>
      {save ? <SaveButton {...save} /> : null}
    </div>
  );
}
