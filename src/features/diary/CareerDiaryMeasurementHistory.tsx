import type { CareerDiaryGoalSummary, CareerDiaryMeasurement } from '../../../shared/careerDiary';
import { formatCareerDiaryDate, formatCareerDiaryValue } from './careerDiaryModel';

interface CareerDiaryMeasurementHistoryProps {
  readonly goal: CareerDiaryGoalSummary;
  readonly measurements: readonly CareerDiaryMeasurement[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly onLoadMore: () => void;
}

export function CareerDiaryMeasurementHistory(props: CareerDiaryMeasurementHistoryProps) {
  return (
    <section className="career-diary-history" aria-labelledby="career-diary-history-title" aria-busy={props.loadingMore}>
      <h3 id="career-diary-history-title">История замеров <span>{props.measurements.length}</span></h3>
      {props.measurements.length === 0 ? (
        <p className="career-diary-note">Замеров пока нет. Первое значение введёте вы.</p>
      ) : <MeasurementTable goal={props.goal} measurements={props.measurements} />}
      {props.error ? <p className="career-diary-error" role="alert">{props.error}</p> : null}
      {props.nextCursor ? (
        <button className="career-btn is-ghost" type="button" disabled={props.loadingMore} onClick={props.onLoadMore}>
          {props.loadingMore ? 'Загружаем…' : 'Показать ещё замеры'}
        </button>
      ) : null}
    </section>
  );
}

function MeasurementTable({
  goal,
  measurements,
}: {
  readonly goal: CareerDiaryGoalSummary;
  readonly measurements: readonly CareerDiaryMeasurement[];
}) {
  return (
    <table className="career-diary-history__table">
      <caption className="career-sr-only">Значения цели, дата и источник</caption>
      <thead><tr><th scope="col">Дата</th><th scope="col">Значение</th><th scope="col">Источник</th><th scope="col">Комментарий</th></tr></thead>
      <tbody>{measurements.map((measurement) => (
        <tr key={measurement.id}>
          <td data-label="Дата">{formatCareerDiaryDate(measurement.measuredAt)}</td>
          <td data-label="Значение">{formatCareerDiaryValue(measurement.value)} {goal.unit}</td>
          <td data-label="Источник">{measurement.source === 'candidate_entered' ? 'Ввели вы' : 'Неизвестно'}</td>
          <td data-label="Комментарий">{measurement.note || 'Не указан'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
