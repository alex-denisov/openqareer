import { formatCareerDiaryDate, formatCareerDiaryValue } from './careerDiaryModel';
import {
  summarizeCareerDiaryQuarter,
  type CareerDiaryGoalWithQuarterDecision,
  type CareerDiaryQuarterGoalProgress,
} from './careerDiaryPlanning';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

interface CareerDiaryQuarterReviewProps {
  readonly asOf: string | null;
  readonly goals: readonly CareerDiaryGoalWithQuarterDecision[];
  readonly state: CareerDiaryLoadState;
  readonly error: string | null;
  readonly decisionError: string | null;
  readonly savingGoalId: string | null;
  readonly onRetry: () => void;
  readonly onSaveDecision: (goalId: string, decision: 'keep' | 'move') => Promise<void>;
  readonly onOpenConsultant: (goal: CareerDiaryGoalWithQuarterDecision) => void;
}

export function CareerDiaryQuarterReview(props: CareerDiaryQuarterReviewProps) {
  if (props.state === 'loading') {
    return (
      <section className="career-diary-quarter-review career-diary-state" aria-busy="true">
        <h2 id="career-diary-quarter-title" tabIndex={-1}>
          Итоги квартала
        </h2>
        <p role="status">Рассчитываем итоги по сохранённым замерам.</p>
      </section>
    );
  }
  if (props.state === 'error') {
    return (
      <section className="career-diary-quarter-review career-diary-state">
        <h2 id="career-diary-quarter-title" tabIndex={-1}>
          Итоги квартала
        </h2>
        <p className="career-diary-error" role="alert">
          {props.error ?? 'Не удалось загрузить цели.'}
        </p>
        <button className="career-btn is-ghost" type="button" onClick={props.onRetry}>
          Повторить
        </button>
      </section>
    );
  }
  if (!props.asOf) {
    return (
      <section className="career-diary-quarter-review career-diary-state">
        <h2 id="career-diary-quarter-title" tabIndex={-1}>
          Итоги квартала
        </h2>
        <p>Нет даты расчёта. Итоги квартала пока неизвестны.</p>
      </section>
    );
  }
  return <CareerDiaryQuarterReviewContent {...props} asOf={props.asOf} />;
}

function CareerDiaryQuarterReviewContent(
  props: CareerDiaryQuarterReviewProps & { readonly asOf: string },
) {
  const summary = summarizeCareerDiaryQuarter(props.goals, props.asOf);
  const movedGoals = props.goals.filter(
    (goal) =>
      goal.quarterDecision?.quarterId === summary.quarter.id &&
      goal.quarterDecision.decision === 'move',
  );
  const suggestions = summary.goals.filter((goal) => goal.status !== 'complete');
  return (
    <section className="career-diary-quarter-review" aria-labelledby="career-diary-quarter-title">
      <CareerDiaryQuarterHeader summary={summary} asOf={props.asOf} />
      <CareerDiaryQuarterMetrics summary={summary} />
      <CareerDiaryQuarterGoals summary={summary} onOpenConsultant={props.onOpenConsultant} />
      <CareerDiaryQuarterConfidence summary={summary} />
      <CareerDiaryQuarterDecisions
        {...props}
        quarterId={summary.quarter.id}
        nextId={summary.quarter.nextId}
        nextEndDate={summary.quarter.nextEndDate}
        suggestions={suggestions}
        movedGoals={movedGoals}
      />
    </section>
  );
}

function CareerDiaryQuarterHeader({
  summary,
  asOf,
}: {
  readonly summary: ReturnType<
    typeof summarizeCareerDiaryQuarter<CareerDiaryGoalWithQuarterDecision>
  >;
  readonly asOf: string;
}) {
  return (
    <>
      <header className="career-diary-quarter-review__header">
        <h2 id="career-diary-quarter-title" tabIndex={-1}>
          Итоги {summary.quarter.id}
        </h2>
        <p>
          На {formatCareerDiaryDate(asOf)}, до конца квартала{' '}
          {daysUntil(asOf, summary.quarter.endDate)} дней.
        </p>
      </header>
      {summary.goalCount > 0 ? (
        <p className="career-diary-note">
          По {summary.measuredCount} из {summary.goalCount} целей есть замеры за квартал.
        </p>
      ) : null}
      {summary.goalCount === 0 ? (
        <p className="career-diary-note">На этот квартал цели не заданы.</p>
      ) : null}
    </>
  );
}

function CareerDiaryQuarterMetrics({
  summary,
}: {
  readonly summary: ReturnType<
    typeof summarizeCareerDiaryQuarter<CareerDiaryGoalWithQuarterDecision>
  >;
}) {
  return (
    <dl className="career-diary-quarter-metrics">
      <div>
        <dt>Итог квартала</dt>
        <dd>
          {summary.achievedCount} из {summary.goalCount} целей достигнуто
        </dd>
      </div>
      <div>
        <dt>Полнота замеров</dt>
        <dd>
          {summary.measuredCount} из {summary.goalCount}
        </dd>
      </div>
      <div>
        <dt>Средний прогресс по измеримым целям</dt>
        <dd>{summary.progressPercent === null ? 'Нет данных' : `${summary.progressPercent} %`}</dd>
      </div>
    </dl>
  );
}

function CareerDiaryQuarterGoals({
  summary,
  onOpenConsultant,
}: {
  readonly summary: ReturnType<
    typeof summarizeCareerDiaryQuarter<CareerDiaryGoalWithQuarterDecision>
  >;
  readonly onOpenConsultant: CareerDiaryQuarterReviewProps['onOpenConsultant'];
}) {
  return (
    <section
      className="career-diary-quarter-goals"
      aria-labelledby="career-diary-quarter-goals-title"
    >
      <h3 id="career-diary-quarter-goals-title">По целям</h3>
      {summary.goals.map((item, index) => (
        <CareerDiaryQuarterGoalCard
          key={item.goal.id}
          item={item}
          primary={index === 0}
          onOpenConsultant={onOpenConsultant}
        />
      ))}
    </section>
  );
}

function CareerDiaryQuarterGoalCard({
  item,
  primary,
  onOpenConsultant,
}: {
  readonly item: CareerDiaryQuarterGoalProgress<CareerDiaryGoalWithQuarterDecision>;
  readonly primary: boolean;
  readonly onOpenConsultant: CareerDiaryQuarterReviewProps['onOpenConsultant'];
}) {
  const goal = item.goal;
  return (
    <article className="career-diary-quarter-goal">
      <div className="career-diary-quarter-goal__heading">
        <strong>{goal.title}</strong>
        <span>
          {item.progressPercent === null ? 'Прогресс неизвестен' : `${item.progressPercent} %`}
        </span>
      </div>
      <p>{measurementDescription(goal, item.measuredInQuarter)}</p>
      {goal.latestMeasurement ? (
        <p className="career-diary-note">
          Последний замер: {formatCareerDiaryValue(goal.latestMeasurement.value)} {goal.unit},{' '}
          {formatCareerDiaryDate(goal.latestMeasurement.measuredAt)}.
        </p>
      ) : (
        <p className="career-diary-note">Замеров пока нет; прогресс не рассчитывается.</p>
      )}
      <div className="career-diary-quarter-goal__actions">
        <button
          className={`career-btn ${primary ? 'is-primary' : 'is-ghost'}`}
          type="button"
          onClick={() => onOpenConsultant(goal)}
        >
          Обсудить цель
        </button>
      </div>
    </article>
  );
}

function CareerDiaryQuarterConfidence({
  summary,
}: {
  readonly summary: ReturnType<
    typeof summarizeCareerDiaryQuarter<CareerDiaryGoalWithQuarterDecision>
  >;
}) {
  return (
    <section
      className="career-diary-quarter-confidence"
      aria-labelledby="career-diary-quarter-confidence-title"
    >
      <h3 id="career-diary-quarter-confidence-title">Насколько можно верить расчёту</h3>
      <ul>
        <li>
          Замеры за последние 14 дней есть по {summary.freshMeasurementCount} из {summary.goalCount}{' '}
          целей.
        </li>
        <li>
          {summary.unknownCount} целей без актуального замера или исходного значения; их прогресс
          неизвестен.
        </li>
        <li>Значения введены вами. Платформа не проверяет их независимо.</li>
      </ul>
    </section>
  );
}

interface CareerDiaryQuarterDecisionsProps extends CareerDiaryQuarterReviewProps {
  readonly quarterId: string;
  readonly nextId: string;
  readonly nextEndDate: string;
  readonly suggestions: readonly CareerDiaryQuarterGoalProgress<CareerDiaryGoalWithQuarterDecision>[];
  readonly movedGoals: readonly CareerDiaryGoalWithQuarterDecision[];
}

function CareerDiaryQuarterDecisions(props: CareerDiaryQuarterDecisionsProps) {
  return (
    <section
      className="career-diary-quarter-decisions"
      aria-labelledby="career-diary-quarter-decisions-title"
    >
      <h3 id="career-diary-quarter-decisions-title">К следующему кварталу</h3>
      <CareerDiaryMovedGoals goals={props.movedGoals} nextId={props.nextId} />
      {props.suggestions.map((suggestion) => (
        <CareerDiaryQuarterDecisionCard
          key={suggestion.goal.id}
          suggestion={suggestion}
          props={props}
        />
      ))}
      {props.decisionError ? (
        <p className="career-diary-error" role="alert">
          {props.decisionError}
        </p>
      ) : null}
      {props.suggestions.length === 0 && props.movedGoals.length === 0 ? (
        <p className="career-diary-note">Незавершённых целей на этот квартал нет.</p>
      ) : null}
    </section>
  );
}

function CareerDiaryMovedGoals({
  goals,
  nextId,
}: {
  readonly goals: readonly CareerDiaryGoalWithQuarterDecision[];
  readonly nextId: string;
}) {
  return goals.map((goal) => (
    <p className="career-diary-note" key={goal.id}>
      Перенесено в {nextId}: «{goal.title}».
    </p>
  ));
}

function CareerDiaryQuarterDecisionCard({
  suggestion,
  props,
}: {
  readonly suggestion: CareerDiaryQuarterGoalProgress<CareerDiaryGoalWithQuarterDecision>;
  readonly props: CareerDiaryQuarterDecisionsProps;
}) {
  const { goal, status } = suggestion;
  return (
    <article className="career-diary-quarter-decision">
      <strong>{goal.title}</strong>
      <p>
        {status === 'unknown'
          ? 'Нет замеров за квартал. Решение остаётся за вами.'
          : 'Проверьте, переносить ли цель на следующий квартал.'}
      </p>
      <CareerDiaryQuarterDecisionStatus
        goal={goal}
        quarterId={props.quarterId}
        nextId={props.nextId}
      />
      <CareerDiaryQuarterDecisionButtons goalId={goal.id} props={props} />
    </article>
  );
}

function CareerDiaryQuarterDecisionStatus({
  goal,
  quarterId,
  nextId,
}: {
  readonly goal: CareerDiaryGoalWithQuarterDecision;
  readonly quarterId: string;
  readonly nextId: string;
}) {
  if (goal.quarterDecision?.quarterId !== quarterId) return null;
  const status =
    goal.quarterDecision.decision === 'keep'
      ? `Цель останется в ${quarterId}.`
      : `Решение: ${nextId}.`;
  return (
    <p className="career-diary-note" role="status">
      {status}
    </p>
  );
}

function CareerDiaryQuarterDecisionButtons({
  goalId,
  props,
}: {
  readonly goalId: string;
  readonly props: CareerDiaryQuarterDecisionsProps;
}) {
  const saving = props.savingGoalId === goalId;
  return (
    <div className="career-diary-quarter-goal__actions">
      <button
        className="career-btn is-ghost"
        type="button"
        disabled={saving}
        aria-busy={saving}
        onClick={() => void props.onSaveDecision(goalId, 'move')}
      >
        Перенести в {props.nextId}
      </button>
      <button
        className="career-btn is-ghost"
        type="button"
        disabled={saving}
        aria-busy={saving}
        onClick={() => void props.onSaveDecision(goalId, 'keep')}
      >
        Оставить в {props.quarterId}
      </button>
    </div>
  );
}

function measurementDescription(
  goal: CareerDiaryGoalWithQuarterDecision,
  measuredInQuarter: boolean,
): string {
  if (!goal.latestMeasurement) return 'Данных для расчёта нет.';
  if (!measuredInQuarter) return 'Последний замер был до текущего квартала.';
  return `Цель: ${formatCareerDiaryValue(goal.targetValue)} ${goal.unit}.`;
}

function daysUntil(asOf: string, endDate: string): number {
  const from = new Date(`${asOf}T00:00:00.000Z`).getTime();
  const to = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}
