import { useEffect, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { CareerDiaryWorkplace } from '../../../shared/careerDiary';
import { generateStageAdvice } from '../onboarding/executiveOnboarding';
import { formatCareerDiaryDate } from './careerDiaryModel';
import {
  CareerDiaryAdaptationTaskList,
  CareerDiaryTaskEntry,
} from './CareerDiaryAdaptationTaskForm';
import { CAREER_DIARY_ADAPTATION_STAGES } from './careerDiaryAdaptationStages';
import {
  adaptationPlanProgress,
  careerDiaryAdaptationPhase,
  type CareerDiaryAdaptationPlan,
  type CareerDiaryAdaptationStage,
} from './careerDiaryPlanning';
import { useCareerDiaryAdaptationConsultant } from './useCareerDiaryAdaptationConsultant';
import { useCareerDiaryAdaptationPlan } from './useCareerDiaryAdaptationPlan';

interface CareerDiaryAdaptationPlanProps {
  readonly asOf: string | null;
  readonly primaryWorkplace: CareerDiaryWorkplace | null;
  readonly adaptation: ReturnType<typeof useCareerDiaryAdaptationPlan>;
}

export function CareerDiaryAdaptationPlanView({
  asOf,
  primaryWorkplace,
  adaptation,
}: CareerDiaryAdaptationPlanProps) {
  if (adaptation.state === 'loading') {
    return (
      <section className="career-diary-adaptation-workspace career-diary-state" aria-busy="true">
        <h2 id="career-diary-adaptation-title" tabIndex={-1}>
          30–60–90
        </h2>
        <p role="status">Загружаем план адаптации.</p>
      </section>
    );
  }
  if (adaptation.state === 'error') {
    return (
      <section className="career-diary-adaptation-workspace career-diary-state">
        <h2 id="career-diary-adaptation-title" tabIndex={-1}>
          30–60–90
        </h2>
        <p className="career-diary-error" role="alert">
          {adaptation.error ?? 'План адаптации недоступен.'}
        </p>
        <button className="career-btn is-ghost" type="button" onClick={adaptation.reload}>
          Повторить
        </button>
      </section>
    );
  }
  if (!primaryWorkplace || !adaptation.workplace || !asOf) {
    return (
      <section className="career-diary-adaptation-workspace career-diary-state">
        <h2 id="career-diary-adaptation-title" tabIndex={-1}>
          30–60–90
        </h2>
        <p>Добавьте и выберите место работы, чтобы вести план адаптации.</p>
      </section>
    );
  }
  return (
    <CareerDiaryAdaptationPlanContent
      asOf={asOf}
      adaptation={adaptation}
      workplace={adaptation.workplace}
    />
  );
}

function CareerDiaryAdaptationPlanContent({
  asOf,
  adaptation,
  workplace,
}: {
  readonly asOf: string;
  readonly adaptation: ReturnType<typeof useCareerDiaryAdaptationPlan>;
  readonly workplace: CareerDiaryWorkplace;
}) {
  const plan = adaptation.plan;
  const phase = adaptation.phase ?? careerDiaryAdaptationPhase(workplace, asOf);
  const [activeStage, setActiveStage] = useState(stageForPhase(phase));
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  useEffect(() => setActiveStage(stageForPhase(phase)), [phase, plan?.id]);

  return (
    <section
      className="career-diary-adaptation-workspace"
      aria-labelledby="career-diary-adaptation-title"
    >
      <CareerDiaryAdaptationContext workplace={workplace} phase={phase} />
      <CareerDiaryPlanBody
        phase={phase}
        plan={plan}
        workplace={workplace}
        adaptation={adaptation}
        activeStage={activeStage}
        taskFormOpen={taskFormOpen}
        setActiveStage={setActiveStage}
        setTaskFormOpen={setTaskFormOpen}
      />
    </section>
  );
}

function CareerDiaryPlanBody({
  phase,
  plan,
  workplace,
  adaptation,
  activeStage,
  taskFormOpen,
  setActiveStage,
  setTaskFormOpen,
}: {
  readonly phase: ReturnType<typeof careerDiaryAdaptationPhase>;
  readonly plan: CareerDiaryAdaptationPlan | null;
  readonly workplace: CareerDiaryWorkplace;
  readonly adaptation: ReturnType<typeof useCareerDiaryAdaptationPlan>;
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly taskFormOpen: boolean;
  readonly setActiveStage: (stage: CareerDiaryAdaptationStage) => void;
  readonly setTaskFormOpen: (open: boolean) => void;
}) {
  return (
    <>
      {plan ? (
        <CareerDiaryActivePlan
          plan={plan}
          workplace={workplace}
          activeStage={activeStage}
          taskFormOpen={taskFormOpen}
          adaptation={adaptation}
          setActiveStage={setActiveStage}
          setTaskFormOpen={setTaskFormOpen}
        />
      ) : (
        <CareerDiaryPlanLaunch
          phase={phase}
          canLaunch={adaptation.canLaunch}
          saving={adaptation.saving}
          onLaunch={adaptation.launch}
        />
      )}
      {adaptation.error && !taskFormOpen ? (
        <p className="career-diary-error" role="alert">
          {adaptation.error}
        </p>
      ) : null}
    </>
  );
}

function CareerDiaryActivePlan({
  plan,
  workplace,
  activeStage,
  taskFormOpen,
  adaptation,
  setActiveStage,
  setTaskFormOpen,
}: {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly workplace: CareerDiaryWorkplace;
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly taskFormOpen: boolean;
  readonly adaptation: ReturnType<typeof useCareerDiaryAdaptationPlan>;
  readonly setActiveStage: (stage: CareerDiaryAdaptationStage) => void;
  readonly setTaskFormOpen: (open: boolean) => void;
}) {
  return (
    <>
      <CareerDiaryPlanContents
        plan={plan}
        workplace={workplace}
        activeStage={activeStage}
        readOnly={!adaptation.canEdit}
        saving={adaptation.saving}
        onStageChange={setActiveStage}
        onTaskChange={adaptation.setTaskCompleted}
        onAddTask={() => setTaskFormOpen(true)}
        onClosePlan={adaptation.closePlan}
      />
      {taskFormOpen && adaptation.canEdit ? (
        <CareerDiaryTaskEntry
          stage={activeStage}
          saving={adaptation.saving}
          error={adaptation.error}
          onCancel={() => setTaskFormOpen(false)}
          onSave={adaptation.addTask}
          onSaved={() => setTaskFormOpen(false)}
        />
      ) : null}
    </>
  );
}

function CareerDiaryAdaptationContext({
  workplace,
  phase,
}: {
  readonly workplace: CareerDiaryWorkplace;
  readonly phase: ReturnType<typeof careerDiaryAdaptationPhase>;
}) {
  return (
    <>
      <header className="career-diary-adaptation-header">
        <h2 id="career-diary-adaptation-title" tabIndex={-1}>
          30–60–90
        </h2>
        <p>Задачи первых трёх месяцев в новой роли.</p>
        <p className="career-diary-note">{workplacePhaseCopy(phase, workplace.startDate)}</p>
      </header>
      {workplace.status === 'archived' ? (
        <p className="career-diary-note" role="status">
          Работу завершили: архив. План доступен только для чтения.
        </p>
      ) : null}
    </>
  );
}

function CareerDiaryPlanLaunch({
  phase,
  canLaunch,
  saving,
  onLaunch,
}: {
  readonly phase: ReturnType<typeof careerDiaryAdaptationPhase>;
  readonly canLaunch: boolean;
  readonly saving: boolean;
  readonly onLaunch: () => Promise<boolean>;
}) {
  if (phase === 'past_90') {
    return (
      <p className="career-diary-note" role="status">
        Дата выхода больше 90 дней назад. Запустить план адаптации уже нельзя.
      </p>
    );
  }
  if (phase === 'archived') return null;
  return (
    <section className="career-diary-adaptation-launch">
      <h3>{phase === 'offer_accepted' ? 'Оффер принят' : 'План пока не запущен'}</h3>
      <p>
        {phase === 'offer_accepted'
          ? 'Подготовьте первые задачи до выхода на работу.'
          : 'Запустите план, чтобы отмечать задачи и видеть прогресс адаптации.'}
      </p>
      {canLaunch ? (
        <button
          className="career-btn is-primary"
          type="button"
          disabled={saving}
          aria-busy={saving}
          onClick={() => void onLaunch()}
        >
          {saving ? 'Запускаем…' : 'Запустить план'}
        </button>
      ) : null}
    </section>
  );
}

function CareerDiaryPlanContents({
  plan,
  workplace,
  activeStage,
  readOnly,
  saving,
  onStageChange,
  onTaskChange,
  onAddTask,
  onClosePlan,
}: {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly workplace: CareerDiaryWorkplace;
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onStageChange: (stage: CareerDiaryAdaptationStage) => void;
  readonly onTaskChange: (taskId: string, completed: boolean) => Promise<boolean>;
  readonly onAddTask: () => void;
  readonly onClosePlan: () => Promise<boolean>;
}) {
  return (
    <>
      <StageTabs plan={plan} activeStage={activeStage} onChange={onStageChange} />
      <div className="career-diary-adaptation-columns">
        <CareerDiaryStageTaskPanel
          plan={plan}
          activeStage={activeStage}
          readOnly={readOnly}
          saving={saving}
          onTaskChange={onTaskChange}
          onAddTask={onAddTask}
          onClosePlan={onClosePlan}
        />
        <CareerDiaryStageAdvice workplace={workplace} plan={plan} activeStage={activeStage} />
      </div>
    </>
  );
}

function CareerDiaryStageTaskPanel({
  plan,
  activeStage,
  readOnly,
  saving,
  onTaskChange,
  onAddTask,
  onClosePlan,
}: {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly activeStage: CareerDiaryAdaptationStage;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onTaskChange: (taskId: string, completed: boolean) => Promise<boolean>;
  readonly onAddTask: () => void;
  readonly onClosePlan: () => Promise<boolean>;
}) {
  const tasks = plan.tasks.filter((task) => task.stage === activeStage);
  const progress = adaptationPlanProgress(plan, activeStage);
  return (
    <section
      className="career-diary-adaptation-task-list"
      id={`career-diary-adaptation-stage-${activeStage}`}
      role="tabpanel"
      aria-labelledby={`career-diary-adaptation-tab-${activeStage}`}
    >
      <header className="career-diary-adaptation-task-list__header">
        <h3>
          {stageLabel(activeStage)}: {tasks.length} задач
        </h3>
        <CareerDiaryStageTaskAction readOnly={readOnly} saving={saving} onAddTask={onAddTask} />
      </header>
      <p className="career-diary-note">
        Выполнено {progress.completed} из {progress.total} задач этапа.
      </p>
      <CareerDiaryAdaptationTaskList
        tasks={tasks}
        readOnly={readOnly}
        saving={saving}
        onTaskChange={onTaskChange}
      />
      <CareerDiaryPlanProgress
        plan={plan}
        readOnly={readOnly}
        saving={saving}
        onClosePlan={onClosePlan}
      />
    </section>
  );
}

function CareerDiaryStageTaskAction({
  readOnly,
  saving,
  onAddTask,
}: {
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onAddTask: () => void;
}) {
  if (readOnly) return <span className="career-diary-note">Только для чтения</span>;
  return (
    <button className="career-btn is-primary" type="button" disabled={saving} onClick={onAddTask}>
      <Plus size={18} aria-hidden="true" />
      Добавить задачу
    </button>
  );
}

function CareerDiaryPlanProgress({
  plan,
  readOnly,
  saving,
  onClosePlan,
}: {
  readonly plan: CareerDiaryAdaptationPlan;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onClosePlan: () => Promise<boolean>;
}) {
  const progress = adaptationPlanProgress(plan);
  return (
    <>
      <p className="career-diary-note">
        Выполнено {progress.completed} из {progress.total} задач.
      </p>
      {plan.status === 'active' && !readOnly ? (
        <button
          className="career-btn is-ghost"
          type="button"
          disabled={saving}
          onClick={() => void onClosePlan()}
        >
          Закрыть план
        </button>
      ) : null}
      {plan.status === 'closed' ? (
        <p className="career-diary-note" role="status">
          План адаптации закрыт.
        </p>
      ) : null}
    </>
  );
}

function CareerDiaryStageAdvice({
  workplace,
  plan,
  activeStage,
}: {
  readonly workplace: CareerDiaryWorkplace;
  readonly plan: CareerDiaryAdaptationPlan;
  readonly activeStage: CareerDiaryAdaptationStage;
}) {
  const advice = generateStageAdvice(onboardingStage(activeStage));
  return (
    <aside
      className="career-diary-adaptation-advice"
      aria-label={`Совет этапа ${stageLabel(activeStage)}`}
    >
      <h3>Совет этапа {stageLabel(activeStage)}</h3>
      {advice.map((item) => (
        <p key={item}>{item}</p>
      ))}
      <p className="career-diary-note">
        Общие рекомендации для руководителей, не оценка вашей ситуации.
      </p>
      <CareerDiaryAdaptationConsultant
        workplace={workplace}
        plan={plan}
        activeStage={activeStage}
      />
    </aside>
  );
}

function StageTabs({
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
            <strong>{stage.label}</strong>
            <span>
              {progress.completed} из {progress.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CareerDiaryAdaptationConsultant({
  workplace,
  plan,
  activeStage,
}: {
  readonly workplace: CareerDiaryWorkplace;
  readonly plan: CareerDiaryAdaptationPlan;
  readonly activeStage: CareerDiaryAdaptationStage;
}) {
  const result = useCareerDiaryAdaptationConsultant(workplace, plan, activeStage);
  return (
    <div className="career-diary-adaptation-consultant">
      <button
        className="career-btn is-ghost"
        type="button"
        disabled={result.sending}
        aria-busy={result.sending}
        onClick={() => void result.ask()}
      >
        {result.sending ? 'Спрашиваем консультанта…' : 'Обсудить план с консультантом'}
      </button>
      {result.answer ? (
        <p className="career-diary-consultant-response" role="status">
          {result.answer}
        </p>
      ) : null}
      {result.error ? (
        <p className="career-diary-error" role="alert">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}

function stageForPhase(
  phase: ReturnType<typeof careerDiaryAdaptationPhase>,
): CareerDiaryAdaptationStage {
  if (phase === 'offer_accepted') return 'prep';
  if (phase === 'days_31_60') return 'days_31_60';
  if (phase === 'days_61_90' || phase === 'past_90' || phase === 'archived') return 'days_61_90';
  return 'days_1_30';
}

function stageLabel(stage: CareerDiaryAdaptationStage): string {
  return CAREER_DIARY_ADAPTATION_STAGES.find((item) => item.id === stage)!.label;
}

function workplacePhaseCopy(
  phase: ReturnType<typeof careerDiaryAdaptationPhase>,
  startDate: string,
): string {
  if (phase === 'offer_accepted')
    return `Оффер принят: дата выхода ${formatCareerDiaryDate(startDate)}.`;
  if (phase === 'days_1_30')
    return `Адаптация: выход меньше месяца назад (${formatCareerDiaryDate(startDate)}).`;
  if (phase === 'days_31_60')
    return `Адаптация: выход 1–2 месяца назад (${formatCareerDiaryDate(startDate)}).`;
  if (phase === 'days_61_90')
    return `Адаптация: выход 2–3 месяца назад (${formatCareerDiaryDate(startDate)}).`;
  if (phase === 'past_90') return 'Дата выхода больше 90 дней назад.';
  return 'Работу завершили: архив.';
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
