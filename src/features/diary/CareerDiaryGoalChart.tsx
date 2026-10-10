import type { CareerDiaryGoalSummary, CareerDiaryMeasurement } from '../../../shared/careerDiary';
import { formatCareerDiaryDate, formatCareerDiaryShortDate, formatCareerDiaryValue, numericMeasurementsForChart } from './careerDiaryModel';

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 240;
const INSET_X = 48;
const INSET_Y = 24;

interface Point {
  readonly x: number;
  readonly y: number;
  readonly date: string;
  readonly value: number;
}

export function CareerDiaryGoalChart({
  goal,
  measurements,
}: {
  readonly goal: CareerDiaryGoalSummary;
  readonly measurements: readonly CareerDiaryMeasurement[];
}) {
  const points = numericMeasurementsForChart(measurements);
  if (typeof goal.targetValue !== 'number') return <p className="career-diary-note">График доступен для числовых целей.</p>;
  if (!points) return <p className="career-diary-note">График появится после первого числового замера.</p>;

  const geometry = chartPoints(points, goal);
  const summary = chartSummary(goal, points);
  return (
    <figure className="career-diary-chart">
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={summary}>
        <title>{goal.title}: ваши замеры и целевое значение</title>
        <desc>{summary}</desc>
        <ChartGrid min={geometry.min} max={geometry.max} yFor={geometry.yFor} />
        <line className="career-diary-chart__target" x1={INSET_X} x2={VIEW_WIDTH - INSET_X} y1={geometry.yFor(goal.targetValue)} y2={geometry.yFor(goal.targetValue)} />
        <polyline className="career-diary-chart__measurements" points={geometry.points.map(({ x, y }) => `${x},${y}`).join(' ')} />
        {geometry.points.map((point, index) => <ChartPoint key={`${point.date}-${point.value}-${index}`} point={point} />)}
        <text className="career-diary-chart__axis-label" x={INSET_X} y={VIEW_HEIGHT - 4}>{formatCareerDiaryShortDate(geometry.points[0]!.date)}</text>
        <text className="career-diary-chart__axis-label" x={VIEW_WIDTH - INSET_X} y={VIEW_HEIGHT - 4} textAnchor="end">{formatCareerDiaryShortDate(geometry.points.at(-1)!.date)}</text>
      </svg>
      <figcaption>
        <span><i className="career-diary-chart__legend-line" />Ваши замеры</span>
        <span><i className="career-diary-chart__legend-target" />Целевое значение: {formatCareerDiaryValue(goal.targetValue)} {goal.unit}</span>
      </figcaption>
      <MeasurementTable goal={goal} points={points} />
    </figure>
  );
}

function chartPoints(
  values: readonly { readonly date: string; readonly value: number }[],
  goal: CareerDiaryGoalSummary,
) {
  const rangeValues = [goal.targetValue as number, ...values.map((point) => point.value)];
  if (goal.baselineValue !== null) rangeValues.push(goal.baselineValue);
  const rawMin = Math.min(...rangeValues);
  const rawMax = Math.max(...rangeValues);
  const padding = rawMin === rawMax ? Math.max(Math.abs(rawMin) * 0.1, 1) : (rawMax - rawMin) * 0.12;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const xFor = (index: number) => values.length === 1
    ? VIEW_WIDTH / 2
    : INSET_X + index * (VIEW_WIDTH - INSET_X * 2) / (values.length - 1);
  const yFor = (value: number) => VIEW_HEIGHT - INSET_Y - (value - min) *
    (VIEW_HEIGHT - INSET_Y * 2) / (max - min);
  const points: Point[] = values.map((point, index) => ({ ...point, x: xFor(index), y: yFor(point.value) }));
  return { points, min, max, yFor };
}

function ChartGrid({
  min,
  max,
  yFor,
}: {
  readonly min: number;
  readonly max: number;
  readonly yFor: (value: number) => number;
}) {
  const middle = (min + max) / 2;
  return (
    <g aria-hidden="true">
      {[min, middle, max].map((value) => (
        <g key={value}>
          <line className="career-diary-chart__grid" x1={INSET_X} x2={VIEW_WIDTH - INSET_X} y1={yFor(value)} y2={yFor(value)} />
          <text className="career-diary-chart__tick" x={INSET_X - 8} y={yFor(value)} textAnchor="end">{formatCareerDiaryValue(value)}</text>
        </g>
      ))}
    </g>
  );
}

function ChartPoint({ point }: { readonly point: Point }) {
  return <circle className="career-diary-chart__point" cx={point.x} cy={point.y} r="5"><title>{formatCareerDiaryDate(point.date)}: {formatCareerDiaryValue(point.value)}</title></circle>;
}

function chartSummary(
  goal: CareerDiaryGoalSummary,
  points: readonly { readonly date: string; readonly value: number }[],
): string {
  const latest = points[points.length - 1]!;
  return `${goal.title}. ${points.length} ваших замеров. Последний: ${formatCareerDiaryValue(latest.value)} ${goal.unit}, ${formatCareerDiaryDate(latest.date)}. Цель: ${formatCareerDiaryValue(goal.targetValue)} ${goal.unit} к ${formatCareerDiaryDate(goal.dueDate)}.`;
}

function MeasurementTable({
  goal,
  points,
}: {
  readonly goal: CareerDiaryGoalSummary;
  readonly points: readonly { readonly date: string; readonly value: number }[];
}) {
  return (
    <table className="career-diary-chart__table">
      <caption>Замеры, представленные на графике</caption>
      <thead><tr><th scope="col">Дата</th><th scope="col">Значение</th><th scope="col">Источник</th></tr></thead>
      <tbody>{points.map((point, index) => (
        <tr key={`${point.date}-${point.value}-${index}`}>
          <td>{formatCareerDiaryDate(point.date)}</td>
          <td>{formatCareerDiaryValue(point.value)} {goal.unit}</td>
          <td>Ввели вы</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
