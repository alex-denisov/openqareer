import { ArrowClockwise, CaretRight, Warning } from '@phosphor-icons/react';
import type { CareerDiaryGoalSummary } from '../../../shared/careerDiary';
import { formatCareerDiaryDate, formatCareerDiaryValue, goalHorizonLabel, goalRiskLabel, groupGoalsByHorizon } from './careerDiaryModel';
import type { CareerDiaryGoalGroup } from './careerDiaryModel';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

interface CareerDiaryGoalListProps {
  readonly goals: readonly CareerDiaryGoalSummary[];
  readonly state: CareerDiaryLoadState;
  readonly error: string | null;
  readonly loadMoreError: string | null;
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
  readonly onOpenGoal: (goalId: string) => void;
}

export function CareerDiaryGoalList(props: CareerDiaryGoalListProps) {
  if (props.state === 'loading' && props.goals.length === 0) return <GoalsLoading />;
  if (props.state === 'error' && props.goals.length === 0) {
    return <GoalsError message={props.error} onRetry={props.onRetry} />;
  }
  if (props.goals.length === 0) return <GoalsEmpty />;

  const groups = groupGoalsByHorizon(props.goals);
  return (
    <section className="career-diary-goals" aria-labelledby="career-diary-goals-title" aria-busy={props.loadingMore}>
      <header className="career-diary-section-header">
        <h2 id="career-diary-goals-title">Цели и KPI</h2>
        <p>{props.goals.length} {goalCountLabel(props.goals.length)}</p>
      </header>
      {props.error ? <p className="career-diary-error" role="alert">{props.error}</p> : null}
      {groups.map((group) => (
        <GoalGroup key={group.horizon} group={group} onOpenGoal={props.onOpenGoal} />
      ))}
      <p className="career-diary-provenance">Значения вводите вы. Платформа не измеряет их в компании.</p>
      {props.loadMoreError ? <p className="career-diary-error" role="alert">{props.loadMoreError}</p> : null}
      {props.nextCursor ? (
        <button className="career-btn is-ghost" type="button" disabled={props.loadingMore} onClick={props.onLoadMore}>
          {props.loadingMore ? 'Загружаем…' : 'Показать ещё цели'}
        </button>
      ) : null}
    </section>
  );
}

function GoalGroup({
  group,
  onOpenGoal,
}: {
  readonly group: CareerDiaryGoalGroup<CareerDiaryGoalSummary>;
  readonly onOpenGoal: (goalId: string) => void;
}) {
  return (
    <section className="career-diary-goal-group" aria-label={goalHorizonLabel(group.horizon)}>
      <h3>{goalHorizonLabel(group.horizon)} <span>{group.goals.length}</span></h3>
      <ul>
        {group.goals.map((goal) => (
          <li key={goal.id}><GoalRow goal={goal} onOpen={() => onOpenGoal(goal.id)} /></li>
        ))}
      </ul>
    </section>
  );
}

function GoalRow({ goal, onOpen }: { readonly goal: CareerDiaryGoalSummary; readonly onOpen: () => void }) {
  const status = goalRiskLabel(goal.risk.status);
  const measurement = goal.latestMeasurement;
  const value = measurement
    ? `${formatCareerDiaryValue(measurement.value)} ${goal.unit} · ${formatCareerDiaryDate(measurement.measuredAt)} · ввели вы`
    : `Замеров пока нет · цель ${formatCareerDiaryValue(goal.targetValue)} ${goal.unit}`;
  return (
    <button className="career-diary-goal-row" type="button" onClick={onOpen}>
      <span className="career-diary-goal-row__main">
        <span className="career-diary-goal-row__title">{goal.title}</span>
        <span className="career-diary-goal-row__meta">{goalTypeLabel(goal.type)} · срок {formatCareerDiaryDate(goal.dueDate)}</span>
      </span>
      <span className="career-diary-goal-row__value">{value}</span>
      <span className={`career-diary-status-chip is-${goal.risk.status}`}>
        {goal.risk.status === 'at_risk' ? <Warning size={16} aria-hidden="true" /> : null}
        {status}
      </span>
      <CaretRight size={18} aria-hidden="true" />
    </button>
  );
}

function GoalsLoading() {
  return <section className="career-diary-state" aria-busy="true"><p role="status">Загружаем цели.</p><span className="career-diary-skeleton" /></section>;
}

function GoalsError({ message, onRetry }: { readonly message: string | null; readonly onRetry: () => void }) {
  return (
    <section className="career-diary-state">
      <p className="career-diary-error" role="alert">{message ?? 'Не удалось загрузить цели.'}</p>
      <button className="career-btn is-ghost" type="button" onClick={onRetry}><ArrowClockwise size={18} aria-hidden="true" />Повторить</button>
    </section>
  );
}

function GoalsEmpty() {
  return <section className="career-diary-empty"><h2>Целей пока нет</h2><p>Добавьте цель, чтобы записывать свои замеры и видеть её статус.</p></section>;
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

function goalCountLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'целей';
  if (mod10 === 1) return 'цель';
  return mod10 >= 2 && mod10 <= 4 ? 'цели' : 'целей';
}
