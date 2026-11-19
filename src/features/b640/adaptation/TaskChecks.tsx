import { useState } from 'react';
import type { CareerDiaryAdaptationTask } from '../../../../shared/careerDiaryCards';
import { StatusLine } from '../kit/ResultLine';
import { dayLabel } from './adaptationModel';

export type ToggleTask = (taskId: string, completed: boolean) => Promise<void>;

interface Props {
  readonly tasks: readonly CareerDiaryAdaptationTask[];
  readonly onToggle: ToggleTask;
  readonly readOnly?: boolean;
}

/** Задачи шага флажками: отметка сохраняется сразу, ошибка — строкой под списком. */
export function TaskChecks({ tasks, onToggle, readOnly = false }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; completed: boolean } | null>(null);
  async function toggle(id: string, completed: boolean) {
    setBusy(id);
    setFailed(null);
    try {
      await onToggle(id, completed);
    } catch {
      setFailed({ id, completed });
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <ul className="checks">
        {tasks.map((task) => (
          <li className="check" key={task.id}>
            <input
              type="checkbox"
              id={`at-${task.id}`}
              checked={task.completed}
              disabled={readOnly || busy !== null}
              onChange={(event) => void toggle(task.id, event.target.checked)}
            />
            <label htmlFor={`at-${task.id}`}>
              {task.title}
              <span className="when">{` · до ${dayLabel(task.dueDate)}`}</span>
            </label>
          </li>
        ))}
      </ul>
      {failed ? (
        <StatusLine
          state="err"
          text="Отметка не сохранилась"
          action={
            <button className="row-act" type="button" onClick={() => void toggle(failed.id, failed.completed)}>
              Повторить
            </button>
          }
        />
      ) : null}
    </>
  );
}
