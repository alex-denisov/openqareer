import type { ReactNode } from 'react';
import type { SearchConditionsDraft } from '../../career-map/careerScreenTypes';
import { Button, RowAction, StatusLine } from '../kit';

export interface EditorProps {
  readonly value: SearchConditionsDraft;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onSave: (next: SearchConditionsDraft) => void;
  readonly onCancel: () => void;
}

const SAVE_ERROR = 'Не сохранилось. Значение осталось в поле — попробуйте ещё раз.';

/** Рамка правки одного условия: поля, «Сохранить», «Отменить», ошибка на месте. */
export function EditFrame({
  label,
  busy,
  failed,
  canSave = true,
  onSave,
  onCancel,
  children,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly canSave?: boolean;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="cc-edit" role="group" aria-label={`Редактирование: ${label}`}>
      {children}
      {failed ? <StatusLine state="err" text={SAVE_ERROR} /> : null}
      <div className="cc-acts">
        <Button variant="primary" icon="check" busy={busy} disabled={!canSave} onClick={onSave}>
          Сохранить
        </Button>
        <RowAction neutral onClick={onCancel}>
          Отменить
        </RowAction>
      </div>
    </div>
  );
}
