import { useState } from 'react';
import type {
  CareerDiaryAdaptationStageView,
  CareerDiaryAdaptationStepId,
  CareerDiaryAdaptationTask,
} from '../../../../shared/careerDiaryCards';
import { Button } from '../kit/Button';
import { Icon } from '../kit/Icon';
import { InfoTip } from '../kit/InfoTip';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { useScreenChrome } from '../shell/ShellContext';
import {
  dayHeading,
  dayLabel,
  probationLine,
  PROGRESS_TAG,
  stageSub,
  stageTitle,
  STEP_TAG,
  STEP_TITLE,
  stepSub,
  taskWhen,
} from './adaptationModel';
import { AddTaskDialog } from './AddTaskDialog';
import { AdaptationGate, type AdaptationActions } from './AdaptationGate';
import type { AdaptationData } from './useAdaptation';

/** Узел экрана шага; шаг без готового экрана в списке не показывается. */
const STEP_NODE: Readonly<Partial<Record<CareerDiaryAdaptationStepId, string>>> = {
  before_start: 'd01a',
  first_two_weeks: 'd01b',
  first_meeting: 'd01c',
  people_map: 'd01d',
  day_30_check: 'd01e',
  settling: 'd01f',
};
const STEP_CLASS = { done: 'done', active: 'now', ahead: '' } as const;

function TaskItem({ task, onToggle }: {
  readonly task: CareerDiaryAdaptationTask;
  readonly onToggle: (id: string, completed: boolean) => void;
}) {
  return (
    <li className={task.completed ? 'dn-task is-done' : 'dn-task'}>
      <button
        className="icon-btn"
        type="button"
        aria-pressed={task.completed}
        aria-label={`Готово: ${task.title}`}
        onClick={() => onToggle(task.id, !task.completed)}
      >
        <Icon name={task.completed ? 'checkc' : 'circle'} />
      </button>
      <span>
        <span className="dn-text">{task.title}</span>
        <span className="row-sub">{taskWhen(task)}</span>
      </span>
    </li>
  );
}

function Stage({ stage, onToggle }: {
  readonly stage: CareerDiaryAdaptationStageView;
  readonly onToggle: (id: string, completed: boolean) => void;
}) {
  const [tone, text] = PROGRESS_TAG[stage.status];
  const title = stageTitle(stage);
  return (
    <li className={`step ${STEP_CLASS[stage.status]}`.trim()}>
      <span className="step-title">{title}</span>
      <span className="step-sub">{stageSub(stage)}</span>
      <span className={`tag ${tone}`.trim()}>{text}</span>
      <ul className="dn-tasks" aria-label={`Задачи: ${title}`}>
        {stage.tasks.map((task) => (
          <TaskItem key={task.id} task={task} onToggle={onToggle} />
        ))}
      </ul>
    </li>
  );
}

function Steps({ data }: { readonly data: AdaptationData }) {
  const shown = data.view.steps.filter((step) => STEP_NODE[step.id]);
  return (
    <section className="mod" aria-labelledby="pl-subs">
      <h3 className="mod-title" id="pl-subs">Адаптация по шагам</h3>
      <ul className="rows">
        {shown.map((step) => {
          const [tone, text] = STEP_TAG[step.status];
          return (
            <li className="row" key={step.id}>
              <div>
                <Link className="row-title" to={buildNodePath(STEP_NODE[step.id]!)}>{STEP_TITLE[step.id]}</Link>
                <div className="row-sub">{stepSub(step, data.view, data.people)}</div>
              </div>
              <span className={`tag ${tone}`.trim()}>{text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Lead({ data, actions }: { readonly data: AdaptationData; readonly actions: AdaptationActions }) {
  const [adding, setAdding] = useState(false);
  // Как у макета d01 (`data-mtight`).
  useScreenChrome({ rootData: { mtight: '1' } });
  const { view, workplace } = data;
  const probation = probationLine(view);
  const goalId = view.stages.find((stage) => stage.status === 'active')?.goalId ?? null;
  const add = (
    <Button variant={goalId ? undefined : 'primary'} icon="plus" onClick={() => setAdding(true)}>
      Добавить задачу
    </Button>
  );
  return (
    <section className="lead" aria-labelledby="pl-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="pl-title">{dayHeading(view.dayNumber, view.stages)}</h2>
        {probation ? <InfoTip label="Испытательный срок" text={probation} /> : null}
      </div>
      <p className="lead-sub">{`${workplace.company} · ${workplace.title} · с ${dayLabel(view.startDate)}`}</p>
      <div className="actions">
        {goalId ? (
          <Link className="btn is-primary" to={buildNodePath('d02a', { goalId })}>
            <Icon name="plus" />
            Внести замер
          </Link>
        ) : null}
        {add}
      </div>
      <ol className="steps dn-plan">
        {view.stages.filter((stage) => stage.stage !== 'prep').map((stage) => (
          <Stage key={stage.stage} stage={stage} onToggle={(id, done) => void actions.toggleTask(id, done)} />
        ))}
      </ol>
      <AddTaskDialog open={adding} startDate={view.startDate} onClose={() => setAdding(false)} onAdd={actions.addTask} />
    </section>
  );
}

/** Экран d01 «План адаптации 30-60-90»: этапы с задачами и шесть шагов со сводкой. */
export function PlanScreen({ node }: { readonly node: B640Node }) {
  return (
    <AdaptationGate node={node}>
      {(data, actions) => (
        <>
          <Lead data={data} actions={actions} />
          <Steps data={data} />
        </>
      )}
    </AdaptationGate>
  );
}
