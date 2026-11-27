import { pressSend } from '../apply/applyIntent';
import { createContext, useContext, type ReactNode } from 'react';
import { Button, Icon, Link, StatusLine, type IconName } from '../kit';

export interface ScreenAction {
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
}

/**
 * Макет s04 на 390: пока внизу полоса вопроса о статусе, кнопка ведущего блока контурная
 * и стоит в потоке под ним, а не своей полосой под полосой вопроса (B645-2). То же с событием
 * отклика (s05b): залитая кнопка — в его карточке.
 */
export const LeadQuietContext = createContext(false);

/** Скелет блока, пока идёт чтение. */
export function BlockSkeleton({
  label,
  rows = 2,
}: {
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <ul className="ls-skel c12-skel" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <li className="c12-skel-row" key={index}>
          <span className="ls-bar w4" />
          <span className="ls-bar w1" />
        </li>
      ))}
    </ul>
  );
}

/** Ошибка чтения на месте блока: строка и «Повторить». */
export function BlockError({
  text,
  onRetry,
}: {
  readonly text: string;
  readonly onRetry: () => void;
}) {
  return (
    <StatusLine
      state="err"
      text={text}
      action={
        <Button size="sm" icon="repeat" onClick={onRetry}>
          Повторить
        </Button>
      }
    />
  );
}

/**
 * Действия главного блока. Залитая кнопка на экране одна. На 390 блок `.actions`
 * с залитой кнопкой закрепляют стили макета: полоса над нижней навигацией,
 * кнопка по содержимому справа (макет s03).
 */
export function LeadActions({
  primary,
  children,
}: {
  readonly primary?: ScreenAction;
  readonly children?: ReactNode;
}) {
  const quiet = useContext(LeadQuietContext);
  if (!primary && !children) return null;
  return (
    <div className="actions">
      {primary ? (
        <Link className={quiet ? 'btn' : 'btn is-primary'} to={primary.path} onClick={() => pressSend(primary, primary.path)}>
          <Icon name={primary.icon} />
          {primary.label}
        </Link>
      ) : null}
      {children}
    </div>
  );
}

/** Вторая и следующие кнопки блока: контурные ссылки. */
export function ActionLink({ action }: { readonly action: ScreenAction }) {
  return (
    <Link className="btn" to={action.path} onClick={() => pressSend(action, action.path)}>
      <Icon name={action.icon} />
      {action.label}
    </Link>
  );
}
