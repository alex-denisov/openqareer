import { CaretLeft, PencilSimple, Sparkle, Warning } from '@phosphor-icons/react';
import type { CareerDiaryGoalSummary, CareerDiaryMeasurement, CareerDiaryMeasurementInput } from '../../../shared/careerDiary';
import { formatCareerDiaryDate, formatCareerDiaryValue, goalHorizonLabel, goalRiskLabel } from './careerDiaryModel';
import { CareerDiaryGoalChart } from './CareerDiaryGoalChart';
import { CareerDiaryMeasurementForm } from './CareerDiaryMeasurementForm';
import { CareerDiaryMeasurementHistory } from './CareerDiaryMeasurementHistory';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

interface CareerDiaryGoalDetailProps {
  readonly goal: CareerDiaryGoalSummary | null;
  readonly measurements: readonly CareerDiaryMeasurement[];
  readonly nextCursor: string | null;
  readonly state: CareerDiaryLoadState;
  readonly error: string | null;
  readonly loadingMore: boolean;
  readonly measurementSaving: boolean;
  readonly onBack: () => void;
  readonly onEdit: () => void;
  readonly onAskConsultant: () => void;
  readonly onLoadMore: () => void;
  readonly onRecordMeasurement: (input: CareerDiaryMeasurementInput) => Promise<void>;
}

export function CareerDiaryGoalDetail(props: CareerDiaryGoalDetailProps) {
  if (props.state === 'loading' && !props.goal) return <GoalDetailLoading onBack={props.onBack} />;
  if (!props.goal) return <GoalDetailError error={props.error} onBack={props.onBack} />;

  const { goal } = props;
  return (
    <article className="career-diary-goal-detail">
      <GoalHeading goal={goal} onBack={props.onBack} onEdit={props.onEdit} />
      {props.error ? <p className="career-diary-error" role="alert">{props.error}</p> : null}
      <GoalFacts goal={goal} />
      <RiskNotice goal={goal} />
      <CareerDiaryGoalChart goal={goal} measurements={props.measurements} />
      <div className="career-diary-goal-detail__actions">
        <CareerDiaryMeasurementForm goal={goal} saving={props.measurementSaving} onSave={props.onRecordMeasurement} />
        <aside className="career-diary-consultant">
          <h3>Консультант по цели</h3>
          <p>Обсудите формулировку и ваши замеры. Значения за вас не придумываем.</p>
          <button className="career-btn is-ghost" type="button" onClick={props.onAskConsultant}>
            <Sparkle size={18} aria-hidden="true" />Спросить по этой цели
          </button>
        </aside>
      </div>
      <CareerDiaryMeasurementHistory
        goal={goal}
        measurements={props.measurements}
        nextCursor={props.nextCursor}
        loadingMore={props.loadingMore}
        error={null}
        onLoadMore={props.onLoadMore}
      />
    </article>
  );
}

function GoalHeading({
  goal,
  onBack,
  onEdit,
}: {
  readonly goal: CareerDiaryGoalSummary;
  readonly onBack: () => void;
  readonly onEdit: () => void;
}) {
  return (
    <header className="career-diary-goal-heading">
      <button className="career-btn is-ghost is-icon career-diary-back" type="button" aria-label="Назад к целям" onClick={onBack}>
        <CaretLeft size={20} aria-hidden="true" />
      </button>
      <div>
        <p className="career-diary-eyebrow">{goalHorizonLabel(goal.horizon)} · срок {formatCareerDiaryDate(goal.dueDate)}</p>
        <h2 id="career-diary-goal-title" tabIndex={-1}>{goal.title}</h2>
        <p>{goalTypeLabel(goal.type)} · единица: {goal.unit} · источник: ввели вы</p>
      </div>
      <span className={`career-diary-status-chip is-${goal.risk.status}`}>{goalRiskLabel(goal.risk.status)}</span>
      <button className="career-btn is-ghost" type="button" onClick={onEdit}>
        <PencilSimple size={18} aria-hidden="true" />Изменить цель
      </button>
    </header>
  );
}

function GoalFacts({ goal }: { readonly goal: CareerDiaryGoalSummary }) {
  return (
    <dl className="career-diary-goal-facts">
      <GoalFact label="Исходное значение" value={goal.baselineValue === null ? 'Не задано' : `${formatCareerDiaryValue(goal.baselineValue)} ${goal.unit}`} />
      <GoalFact label="Последний замер" value={goal.latestMeasurement ? `${formatCareerDiaryValue(goal.latestMeasurement.value)} ${goal.unit} · ${formatCareerDiaryDate(goal.latestMeasurement.measuredAt)}` : 'Замеров пока нет'} />
      <GoalFact label="Целевое значение" value={`${formatCareerDiaryValue(goal.targetValue)} ${goal.unit}`} />
    </dl>
  );
}

function GoalFact({ label, value }: { readonly label: string; readonly value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function RiskNotice({ goal }: { readonly goal: CareerDiaryGoalSummary }) {
  if (goal.risk.status !== 'at_risk' && goal.risk.status !== 'unknown') return null;
  return (
    <p className={`career-diary-risk is-${goal.risk.status}`} role="note">
      <Warning size={18} aria-hidden="true" />
      <span>{goal.risk.explanation}</span>
    </p>
  );
}

function GoalDetailLoading({ onBack }: { readonly onBack: () => void }) {
  return <section className="career-diary-state" aria-busy="true"><button className="career-btn is-ghost" type="button" onClick={onBack}>Назад к целям</button><p role="status">Загружаем цель и замеры.</p></section>;
}

function GoalDetailError({ error, onBack }: { readonly error: string | null; readonly onBack: () => void }) {
  return <section className="career-diary-state"><p className="career-diary-error" role="alert">{error ?? 'Цель недоступна.'}</p><button className="career-btn is-ghost" type="button" onClick={onBack}>Назад к целям</button></section>;
}

function goalTypeLabel(type: CareerDiaryGoalSummary['type']): string {
  const labels: Record<CareerDiaryGoalSummary['type'], string> = {
    operational: 'Операционная',
    team: 'Командная',
    strategic: 'Стратегическая',
    development: 'Развитие',
  };
  return labels[type];
}
