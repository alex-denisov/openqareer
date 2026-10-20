import { useEffect, useState } from 'react';
import { Info } from '@phosphor-icons/react';
import type { CareerDiaryWorkplace } from '../../../shared/careerDiary';
import { formatCareerDiaryDate } from './careerDiaryModel';
import { CareerDiaryTaskEntry } from './CareerDiaryAdaptationTaskForm';
import {
  CareerDiaryStageAside,
  CareerDiaryStageTabs,
  CareerDiaryStageTaskPanel,
} from './CareerDiaryAdaptationStage';
import {
  careerDiaryAdaptationPhase,
  type CareerDiaryAdaptationPlan,
  type CareerDiaryAdaptationStage,
} from './careerDiaryPlanning';
import { useCareerDiaryAdaptationPlan } from './useCareerDiaryAdaptationPlan';
import './career-diary-adaptation.css';

const PLAN_RULES =
  'План адаптации 30–60–90: задачи первых трёх месяцев в новой роли. Выход не больше месяца назад или ещё впереди: предлагаем сами. От одного до двух месяцев: можно запустить вручную, пройденные этапы отмечены. Больше двух месяцев: адаптация считается пройденной и не предлагается. Цели из плана попадают во вкладку «Цели и KPI».';

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
      <CareerDiaryAdaptationContext workplace={workplace} />
      <CareerDiaryPlanBody
        asOf={asOf}
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
  asOf,
  phase,
  plan,
  workplace,
  adaptation,
  activeStage,
  taskFormOpen,
  setActiveStage,
  setTaskFormOpen,
}: {
  readonly asOf: string;
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
          asOf={asOf}
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
          startDate={workplace.startDate}
          canLaunch={adaptation.canLaunch}
          saving={adaptation.saving}
          onLaunch={adaptation.launch}
        />
      )}
      {adaptation.error && !taskFormOpen ? <PlanError message={adaptation.error} /> : null}
    </>
  );
}

function PlanError({ message }: { readonly message: string }) {
  return (
    <p className="career-diary-error" role="alert">
      {message}
    </p>
  );
}

function CareerDiaryActivePlan({
  asOf,
  plan,
  workplace,
  activeStage,
  taskFormOpen,
  adaptation,
  setActiveStage,
  setTaskFormOpen,
}: {
  readonly asOf: string;
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
        asOf={asOf}
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

function CareerDiaryAdaptationContext({ workplace }: { readonly workplace: CareerDiaryWorkplace }) {
  return (
    <>
      <header className="career-diary-adaptation-header">
        <h2 id="career-diary-adaptation-title" tabIndex={-1}>
          30–60–90
        </h2>
        <p>
          Задачи первых трёх месяцев в новой роли. Предлагается, если выход не больше месяца назад
          или ещё впереди.
        </p>
      </header>
      <p className="career-diary-adaptation-rules">
        <Info size={16} aria-hidden="true" />
        <span>{PLAN_RULES}</span>
      </p>
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
  startDate,
  canLaunch,
  saving,
  onLaunch,
}: {
  readonly phase: ReturnType<typeof careerDiaryAdaptationPhase>;
  readonly startDate: string;
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
      <p className="career-diary-note">{workplacePhaseCopy(phase, startDate)}</p>
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
  asOf,
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
  readonly asOf: string;
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
      <CareerDiaryStageTabs plan={plan} activeStage={activeStage} onChange={onStageChange} />
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
        <CareerDiaryStageAside
          asOf={asOf}
          workplace={workplace}
          plan={plan}
          activeStage={activeStage}
        />
      </div>
    </>
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
