import type {
  CareerDiaryGoal,
  CareerDiaryGoalRiskStatus,
  CareerDiaryHorizon,
  CareerDiaryMeasurement,
  CareerDiaryValue,
} from '../../../shared/careerDiary';

export interface CareerDiaryGoalGroup<T extends CareerDiaryGoal = CareerDiaryGoal> {
  readonly horizon: CareerDiaryGoal['horizon'];
  readonly goals: readonly T[];
}

const HORIZON_ORDER: readonly CareerDiaryGoal['horizon'][] = [
  'quarter',
  'next_quarter',
  'year',
];

export function groupGoalsByHorizon<T extends CareerDiaryGoal>(
  goals: readonly T[],
): CareerDiaryGoalGroup<T>[] {
  return HORIZON_ORDER.flatMap((horizon) => {
    const matching = goals
      .filter((goal) => goal.horizon === horizon)
      .slice()
      .sort((first, second) =>
        first.dueDate.localeCompare(second.dueDate) || first.title.localeCompare(second.title),
      );
    return matching.length > 0 ? [{ horizon, goals: matching }] : [];
  });
}

export function numericMeasurementsForChart(
  measurements: readonly CareerDiaryMeasurement[],
): Array<{ readonly date: string; readonly value: number }> | null {
  const points = measurements
    .filter((measurement): measurement is CareerDiaryMeasurement & { value: number } =>
      typeof measurement.value === 'number' && Number.isFinite(measurement.value),
    )
    .slice()
    .sort((first, second) =>
      first.measuredAt.localeCompare(second.measuredAt) || first.id.localeCompare(second.id),
    )
    .map(({ measuredAt, value }) => ({ date: measuredAt, value }));

  return points.length > 0 ? points : null;
}

export function isDueDateBeforeStart(startDate: string, dueDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(dueDate) &&
    dueDate < startDate;
}

export function goalHorizonLabel(horizon: CareerDiaryHorizon): string {
  switch (horizon) {
    case 'quarter':
      return 'Этот квартал';
    case 'next_quarter':
      return 'Следующий квартал';
    case 'year':
      return 'Год';
  }
}

export function goalRiskLabel(status: CareerDiaryGoalRiskStatus): string {
  switch (status) {
    case 'achieved':
      return 'Достигнуто';
    case 'on_track':
      return 'По плану';
    case 'at_risk':
      return 'Под риском';
    case 'planned':
      return 'Запланировано';
    case 'unknown':
      return 'Нет оценки';
  }
}

export function formatCareerDiaryValue(value: CareerDiaryValue): string {
  if (typeof value === 'number') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return value;
}

export function formatCareerDiaryDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatCareerDiaryShortDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}
