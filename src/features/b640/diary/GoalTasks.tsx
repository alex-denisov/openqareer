import { useCallback, useEffect, useState } from 'react';
import type { CareerDiaryAdaptationView } from '../../../../shared/careerDiaryCards';
import {
  setCareerDiaryAdaptationTaskCompleted,
  type CareerDiaryWorkplaceWithPlanning,
} from '../../diary/careerDiaryPlanning';
import { AddTaskDialog } from '../adaptation/AddTaskDialog';
import {
  getAdaptation,
  getOverview,
  getWorkplace,
  patchAdaptation,
  savePlan,
} from '../adaptation/adaptationApi';
import { Icon } from '../kit/Icon';
import { StatusLine } from '../kit/ResultLine';
import { goalTasks, taskWhen, withGoalTask, type NewGoalTask } from './goalTasksModel';

interface Plan {
  readonly workplace: CareerDiaryWorkplaceWithPlanning;
  readonly view: CareerDiaryAdaptationView;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'none' }
  | ({ readonly state: 'ready' } & Plan);

async function loadPlan(): Promise<Loaded> {
  const primary = (await getOverview()).primaryWorkplace;
  if (!primary) return { state: 'none' };
  const [workplace, view] = await Promise.all([
    getWorkplace(primary.id),
    getAdaptation(primary.id),
  ]);
  return { state: 'ready', workplace, view };
}

/** План основного места работы: задачи цели в нём и запись изменений. */
function useGoalPlan() {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadPlan().then(
      (next) => active && setLoaded(next),
      () => active && setLoaded({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { loaded, setLoaded, retry };
}

interface TaskRowsProps {
  readonly plan: Plan;
  readonly goalId: string;
  readonly onChanged: (plan: Plan) => void;
}

function TaskRows({ plan, goalId, onChanged }: TaskRowsProps) {
  // Отметка видна сразу; не сохранилась — возвращается прежняя и строка ошибки.
  const [pending, setPending] = useState<{ id: string; completed: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const tasks = goalTasks(plan.view, goalId);
  async function toggle(taskId: string, completed: boolean) {
    const current = plan.workplace.planning?.adaptationPlan;
    if (!current) return;
    setPending({ id: taskId, completed });
    setFailed(false);
    try {
      const workplace = await savePlan(
        plan.workplace.id,
        setCareerDiaryAdaptationTaskCompleted(current, taskId, completed),
      );
      onChanged({ workplace, view: await getAdaptation(workplace.id) });
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }
  if (tasks.length === 0) return <p className="vl-empty">Задач по цели нет.</p>;
  return (
    <>
      <ul className="gt-tasks">
        {tasks.map((task) => (
          <li className="gt-row" key={task.id}>
            <input
              type="checkbox"
              id={`gt-${task.id}`}
              checked={pending?.id === task.id ? pending.completed : task.completed}
              disabled={pending !== null}
              onChange={(event) => void toggle(task.id, event.target.checked)}
            />
            <label htmlFor={`gt-${task.id}`}>{task.title}</label>
            <span className="gt-when num">{taskWhen(task)}</span>
          </li>
        ))}
      </ul>
      {failed ? <StatusLine state="err" text="Отметка не сохранилась, повторите" /> : null}
    </>
  );
}

function LoadFailed({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text="Задачи не загрузились"
      action={
        <button className="btn is-sm" type="button" onClick={onRetry}>
          Повторить
        </button>
      }
    />
  );
}

/** d02a «Задачи»: задачи плана адаптации по этой цели, отметка и «+ Задача». */
export function GoalTasks({ goalId }: { readonly goalId: string }) {
  const { loaded, setLoaded, retry } = useGoalPlan();
  const [adding, setAdding] = useState(false);
  if (loaded.state === 'none' || loaded.state === 'loading') return null;
  const ready = loaded.state === 'ready' ? loaded : null;
  async function add(input: NewGoalTask) {
    if (!ready) return;
    const { plan, taskId } = withGoalTask(ready.workplace, input, new Date().toISOString());
    const workplace = await savePlan(ready.workplace.id, plan);
    const view = await patchAdaptation(workplace.id, { tasks: { [taskId]: { goalId } } });
    setLoaded({ state: 'ready', workplace, view });
  }
  return (
    <section className="gt-sec" aria-labelledby="ga-k">
      <h3 className="gt-sec-h" id="ga-k">
        Задачи
      </h3>
      {ready ? (
        <TaskRows
          plan={ready}
          goalId={goalId}
          onChanged={(plan) => setLoaded({ state: 'ready', ...plan })}
        />
      ) : (
        <LoadFailed onRetry={retry} />
      )}
      {ready ? (
        <button className="btn is-quiet is-sm gt-add" type="button" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          Задача
        </button>
      ) : null}
      {ready ? (
        <AddTaskDialog
          open={adding}
          startDate={ready.view.startDate}
          onClose={() => setAdding(false)}
          onAdd={(task) => add({ title: task.title, dueDate: task.dueDate })}
        />
      ) : null}
    </section>
  );
}
