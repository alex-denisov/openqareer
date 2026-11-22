import { useCallback, useEffect, useState } from 'react';
import { StatusLine } from '../kit/ResultLine';
import type { NewGoalTask } from './goalTasksModel';
import {
  acceptTaskSuggestion,
  getTaskSuggestion,
  skipTaskSuggestion,
  type TaskSuggestion,
} from './taskSuggestionApi';

/**
 * Подсказка задачи по цели: грузится, когда план готов. Нет подсказки, ответ не пришёл или
 * модель отказала — строки нет, ошибки тоже: подсказка не обязательна.
 */
export function useGoalTaskSuggestion(goalId: string, enabled: boolean) {
  const [suggestion, setSuggestion] = useState<TaskSuggestion | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getTaskSuggestion(goalId).then(
      (next) => active && setSuggestion(next),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [goalId, enabled]);
  const hide = useCallback(() => setSuggestion(null), []);
  return { suggestion, hide };
}

interface RowProps {
  readonly goalId: string;
  readonly suggestion: TaskSuggestion;
  /** Кладёт задачу в план цели; отказ сохранения — исключение, строка остаётся. */
  readonly onAdd: (task: NewGoalTask) => Promise<void>;
  readonly onDone: () => void;
}

/** Последняя строка списка задач: «Добавить» кладёт задачу в план, «Пропустить» прячет строку. */
export function GoalTaskSuggestion({ goalId, suggestion, onAdd, onDone }: RowProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function add() {
    setBusy(true);
    setFailed(false);
    try {
      await onAdd({ title: suggestion.text, dueDate: suggestion.dueDate });
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    // Задача уже в плане: не дошёл ответ серверу — подсказка вернётся лишь при смене данных цели.
    acceptTaskSuggestion(goalId, suggestion.id).catch(() => undefined);
    onDone();
  }
  function skip() {
    skipTaskSuggestion(goalId, suggestion.id).catch(() => undefined);
    onDone();
  }
  return (
    <li className="gt-row gt-sugg">
      <span className="gt-sugg-t">{suggestion.text}</span>
      <span className="gt-sugg-a">
        <button className="btn is-sm" type="button" disabled={busy} onClick={() => void add()}>
          Добавить
        </button>
        <button className="row-act" type="button" disabled={busy} onClick={skip}>
          Пропустить
        </button>
      </span>
      {failed ? <StatusLine state="err" text="Задача не добавилась, повторите" /> : null}
    </li>
  );
}
