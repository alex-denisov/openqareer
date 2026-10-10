import { ArrowClockwise } from '@phosphor-icons/react';
import type { CareerDiaryAchievement, CareerDiaryWeeklyReview } from '../../../shared/careerDiary';
import type { CareerDiaryRecord, CareerDiaryTab } from './useCareerDiaryRecords';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';
import { formatCareerDiaryDate } from './careerDiaryModel';

interface CareerDiaryRecordListProps {
  readonly tab: Exclude<CareerDiaryTab, 'goals'>;
  readonly records: readonly CareerDiaryRecord[];
  readonly state: CareerDiaryLoadState;
  readonly error: string | null;
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}

export function CareerDiaryRecordList(props: CareerDiaryRecordListProps) {
  if (props.state === 'loading' && props.records.length === 0) {
    return <section className="career-diary-state" aria-busy="true"><p role="status">Загружаем записи.</p></section>;
  }
  if (props.state === 'error' && props.records.length === 0) {
    return <RecordError message={props.error} onRetry={props.onRetry} />;
  }
  if (props.records.length === 0) {
    const label = props.tab === 'reviews' ? 'Недельных разборов пока нет' : 'Достижений пока нет';
    return <section className="career-diary-empty"><h2>{label}</h2><p>Здесь будут сохранённые записи дневника.</p></section>;
  }

  return (
    <section className="career-diary-records" aria-label={props.tab === 'reviews' ? 'Разборы недель' : 'Достижения'} aria-busy={props.loadingMore}>
      {props.records.map((record) => (
        props.tab === 'reviews'
          ? <ReviewRecord key={(record as CareerDiaryWeeklyReview).weekStart} record={record as CareerDiaryWeeklyReview} />
          : <AchievementRecord key={(record as CareerDiaryAchievement).id} record={record as CareerDiaryAchievement} />
      ))}
      {props.error ? <p className="career-diary-error" role="alert">{props.error}</p> : null}
      {props.nextCursor ? (
        <button className="career-btn is-ghost" type="button" disabled={props.loadingMore} onClick={props.onLoadMore}>
          {props.loadingMore ? 'Загружаем…' : 'Показать ещё'}
        </button>
      ) : null}
    </section>
  );
}

function ReviewRecord({ record }: { readonly record: CareerDiaryWeeklyReview }) {
  return (
    <details className="career-diary-record">
      <summary>
        <span>Неделя с {formatCareerDiaryDate(record.weekStart)}</span>
        <span className="career-diary-record__state">Сохранено</span>
      </summary>
      <dl>
        <RecordField label="Что сдвинулось" value={record.movedForward} />
        <RecordField label="Что мешало" value={record.blockers} />
        <RecordField label="Чему научился" value={record.learning} />
        <RecordField label="Риски" value={record.risks} />
        <RecordField label="Следующая неделя" value={record.nextWeek} />
      </dl>
    </details>
  );
}

function AchievementRecord({ record }: { readonly record: CareerDiaryAchievement }) {
  return (
    <details className="career-diary-record">
      <summary>
        <span>{formatCareerDiaryDate(record.createdAt.slice(0, 10))}</span>
        <span className="career-diary-record__state">{record.status === 'ready_to_add' ? 'Готово к добавлению' : 'Отложено'}</span>
      </summary>
      <dl>
        <RecordField label="Ситуация" value={record.situation} />
        <RecordField label="Действие" value={record.action} />
        <RecordField label="Результат" value={record.result} />
      </dl>
    </details>
  );
}

function RecordField({ label, value }: { readonly label: string; readonly value: string }) {
  if (!value) return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function RecordError({ message, onRetry }: { readonly message: string | null; readonly onRetry: () => void }) {
  return (
    <section className="career-diary-state">
      <p className="career-diary-error" role="alert">{message ?? 'Не удалось загрузить записи.'}</p>
      <button className="career-btn is-ghost" type="button" onClick={onRetry}><ArrowClockwise size={18} aria-hidden="true" />Повторить</button>
    </section>
  );
}
