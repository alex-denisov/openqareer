import { CaretRight, CheckCircle, Clock, Info, Plus } from '@phosphor-icons/react';
import type { CareerDiaryWorkplace } from '../../../shared/careerDiary';
import { ADAPTATION_STAGE_LABELS } from '../../../shared/adaptationCoach';
import { generateStageAdvice } from '../onboarding/executiveOnboarding';
import { CareerTooltip } from '../shell/CareerTooltip';
import { useAdaptationDiscussion } from './adaptationDiscussion';
import { CareerDiaryAdaptationTaskList } from './CareerDiaryAdaptationTaskForm';
import { CAREER_DIARY_ADAPTATION_STAGES } from './careerDiaryAdaptationStages';
import { formatDayMonth, nearestAdaptationTask, nearestDueCopy } from './careerDiaryAdaptationView';
import {
  adaptationPlanProgress,
  type CareerDiaryAdaptationPlan,
  type CareerDiaryAdaptationStage,
} from './careerDiaryPlanning';

const ADVICE_NOTE = 'Общие рекомендации для руководителей, не оценка вашей ситуации.';
const ADVICE_TOOLTIP = `${ADVICE_NOTE.replace('руководителей,', 'руководителей на этом этапе,')} Конкретные задачи добавляет консультант по вашим разборам.`;

export function CareerDiaryStageTabs({
  plan,
  activeStage,
  onChange,
}: {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly onChange: (stage: CareerDiaryAdaptationStage) => void;
}) {
  return (
    <div
      className="career-diary-adaptation-stages"
      role="tablist"
      aria-label="Этап плана адаптации"
    >
      {CAREER_DIARY_ADAPTATION_STAGES.map((stage) => {
        const progress = adaptationPlanProgress(plan, stage.id);
        const [prefix, range] = splitStageLabel(stage.label);
        return (
          <button
            className="career-diary-adaptation-stage"
            key={stage.id}
            type="button"
            role="tab"
            id={`career-diary-adaptation-tab-${stage.id}`}
            aria-controls={`career-diary-adaptation-stage-${stage.id}`}
            aria-selected={activeStage === stage.id}
            tabIndex={activeStage === stage.id ? 0 : -1}
            onClick={() => onChange(stage.id)}
          >
            <b>
              {prefix ? (
                <span className="career-diary-adaptation-stage__prefix">{prefix}</span>
              ) : null}
              {range}
            </b>
            <span className="career-diary-adaptation-stage__count">
              {progress.completed} из {progress.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface CareerDiaryStageTaskPanelProps {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onTaskChange: (taskId: string, completed: boolean) => Promise<boolean>;
  readonly onAddTask: () => void;
  readonly onClosePlan: () => Promise<boolean>;
}

export function CareerDiaryStageTaskPanel(props: CareerDiaryStageTaskPanelProps) {
  const { plan, activeStage, readOnly, saving, onTaskChange, onAddTask, onClosePlan } = props;
  const tasks = plan.tasks.filter((task) => task.stage === activeStage);
  const progress = adaptationPlanProgress(plan, activeStage);
  const stagePassed = progress.total > 0 && progress.completed === progress.total;
  return (
    <section
      className={`career-diary-adaptation-task-list${stagePassed ? ' is-passed' : ''}`}
      id={`career-diary-adaptation-stage-${activeStage}`}
      role="tabpanel"
      aria-labelledby={`career-diary-adaptation-tab-${activeStage}`}
    >
      {stagePassed ? <CareerDiaryStagePassed completed={progress.completed} /> : null}
      <CareerDiaryStageTaskHeader
        activeStage={activeStage}
        count={tasks.length}
        readOnly={readOnly}
        saving={saving}
        onAddTask={onAddTask}
      />
      <CareerDiaryStageTaskRows
        tasks={tasks}
        readOnly={readOnly}
        saving={saving}
        onTaskChange={onTaskChange}
        onAddTask={onAddTask}
      />
      <p className="career-diary-adaptation-foot">
        {progress.completed} из {progress.total} готовы. Источник каждой задачи указан: шаблон или
        консультант.
      </p>
      <CareerDiaryPlanClosure
        plan={plan}
        activeStage={activeStage}
        readOnly={readOnly}
        saving={saving}
        onClosePlan={onClosePlan}
      />
    </section>
  );
}

function CareerDiaryStagePassed({ completed }: { readonly completed: number }) {
  return (
    <p className="career-diary-adaptation-passed">
      <CheckCircle size={20} aria-hidden="true" />
      Этап пройден: {completed} из {completed} задач выполнены.
    </p>
  );
}

function CareerDiaryStageTaskHeader({
  activeStage,
  count,
  readOnly,
  saving,
  onAddTask,
}: {
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly count: number;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onAddTask: () => void;
}) {
  return (
    <header className="career-diary-adaptation-task-list__header">
      <h3>
        {stageLabel(activeStage)}
        <span className="career-diary-adaptation-sep is-wide">: </span>
        <span className="career-diary-adaptation-sep is-narrow"> · </span>
        {count} {taskWord(count)}
      </h3>
      {readOnly ? (
        <span className="career-diary-note">Только для чтения</span>
      ) : (
        <button className="career-diary-sm-btn" type="button" disabled={saving} onClick={onAddTask}>
          <Plus size={16} aria-hidden="true" />
          Добавить задачу
        </button>
      )}
    </header>
  );
}

function CareerDiaryStageTaskRows({
  tasks,
  readOnly,
  saving,
  onTaskChange,
  onAddTask,
}: {
  readonly tasks: readonly CareerDiaryAdaptationPlan['tasks'][number][];
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onTaskChange: (taskId: string, completed: boolean) => Promise<boolean>;
  readonly onAddTask: () => void;
}) {
  if (!tasks.length && readOnly) {
    return <p className="career-diary-note">На этом этапе задач пока нет.</p>;
  }
  return (
    <ul className="career-diary-otasks">
      <CareerDiaryAdaptationTaskList
        tasks={tasks}
        readOnly={readOnly}
        saving={saving}
        onTaskChange={onTaskChange}
      />
      {readOnly ? null : (
        <li className="career-diary-otask-add">
          <button type="button" disabled={saving} onClick={onAddTask}>
            <span className="career-diary-otask__box">
              <Plus size={18} aria-hidden="true" />
            </span>
            <b>Добавить задачу</b>
            <CaretRight className="career-diary-otask-add__chev" size={16} aria-hidden="true" />
          </button>
        </li>
      )}
    </ul>
  );
}

/** Закрыть план можно только на последнем этапе: в кадрах 1–60 макета 10 этого действия нет. */
function CareerDiaryPlanClosure({
  plan,
  activeStage,
  readOnly,
  saving,
  onClosePlan,
}: {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onClosePlan: () => Promise<boolean>;
}) {
  if (plan.status === 'closed') {
    return (
      <p className="career-diary-note" role="status">
        План адаптации закрыт.
      </p>
    );
  }
  if (readOnly || activeStage !== 'days_61_90') return null;
  return (
    <button
      className="career-diary-sm-btn is-ghost"
      type="button"
      disabled={saving}
      onClick={() => void onClosePlan()}
    >
      Закрыть план
    </button>
  );
}

export function CareerDiaryStageAside({
  asOf,
  workplace,
  plan,
  activeStage,
}: {
  readonly asOf: string;
  readonly workplace: CareerDiaryWorkplace;
  readonly plan: CareerDiaryAdaptationPlan;
  readonly activeStage: CareerDiaryAdaptationStage;
}) {
  useAdaptationDiscussion({
    subject: {
      kind: 'adaptation',
      id: workplace.id,
      planId: plan.id,
      adaptationStage: activeStage,
    },
    title: `${workplace.company} · ${workplace.title} · ${ADAPTATION_STAGE_LABELS[activeStage]}`,
  });
  return (
    <div className="career-diary-adaptation-aside">
      <CareerDiaryStageAdvice activeStage={activeStage} />
      <CareerDiaryNearestTask plan={plan} asOf={asOf} />
    </div>
  );
}

function CareerDiaryStageAdvice({
  activeStage,
}: {
  readonly activeStage: CareerDiaryAdaptationStage;
}) {
  const advice = generateStageAdvice(onboardingStage(activeStage));
  const title = `Совет этапа ${shortStageLabel(activeStage)}`;
  return (
    <section className="career-diary-adaptation-advice" aria-label={title}>
      <header className="career-diary-adaptation-advice__header">
        <h3>{title}</h3>
        <CareerTooltip content={ADVICE_TOOLTIP}>
          <button type="button" className="career-diary-info-btn" aria-label="О советах этапа">
            <Info size={16} aria-hidden="true" />
          </button>
        </CareerTooltip>
      </header>
      <ul className="career-diary-advice">
        {advice.map((item) => (
          <li key={item}>
            <CheckCircle size={20} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="career-diary-adaptation-foot">{ADVICE_NOTE}</p>
    </section>
  );
}

function CareerDiaryNearestTask({
  plan,
  asOf,
}: {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly asOf: string;
}) {
  const task = plan.status === 'active' ? nearestAdaptationTask(plan.tasks) : null;
  if (!task) return null;
  return (
    <section
      className="career-diary-adaptation-nearest"
      aria-labelledby="career-diary-adaptation-nearest"
    >
      <h3 id="career-diary-adaptation-nearest">Ближайшее</h3>
      <div className="career-diary-adaptation-nearest__body">
        <Clock size={20} aria-hidden="true" />
        <p>
          <b>
            До {formatDayMonth(task.dueDate)}: {task.title}
          </b>{' '}
          <span>{nearestDueCopy(task.dueDate, asOf)}</span>
        </p>
      </div>
    </section>
  );
}

function taskWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'задач';
  if (last === 1) return 'задача';
  return last >= 2 && last <= 4 ? 'задачи' : 'задач';
}

function splitStageLabel(label: string): readonly [string, string] {
  return label.startsWith('Дни ') ? ['Дни ', label.slice(4)] : ['', label];
}

function stageLabel(stage: CareerDiaryAdaptationStage): string {
  return CAREER_DIARY_ADAPTATION_STAGES.find((item) => item.id === stage)!.label;
}

function shortStageLabel(stage: CareerDiaryAdaptationStage): string {
  return stage === 'prep' ? 'подготовки' : splitStageLabel(stageLabel(stage))[1];
}

function onboardingStage(stage: CareerDiaryAdaptationStage) {
  const stageMap = {
    prep: 'prep',
    days_1_30: 'days-30',
    days_31_60: 'days-60',
    days_61_90: 'days-90',
  } as const;
  return stageMap[stage];
}
