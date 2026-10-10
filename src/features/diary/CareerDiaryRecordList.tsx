import { ArrowClockwise } from '@phosphor-icons/react';
import type { CareerDiaryAchievement, CareerDiaryAchievementStatus, CareerDiaryWeeklyReview } from '../../../shared/careerDiary';
import type { CareerDiaryAchievementProfileStatus } from './careerDiaryAchievementProfile';
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
  readonly achievementProfileStatuses?: ReadonlyMap<string, CareerDiaryAchievementProfileStatus>;
  readonly profileStatusesLoading?: boolean;
  readonly onAddMissingAchievement?: () => void;
  readonly onAddToProfile?: (achievement: CareerDiaryAchievement) => void;
  readonly onSetAchievementStatus?: (
    achievementId: string,
    status: CareerDiaryAchievementStatus,
  ) => void;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}

export function CareerDiaryRecordList(props: CareerDiaryRecordListProps) {
  if (props.state === 'loading' && props.records.length === 0) return <RecordsLoading />;
  if (props.state === 'error' && props.records.length === 0) {
    return <RecordError message={props.error} onRetry={props.onRetry} />;
  }
  if (props.records.length === 0) return <RecordsEmpty {...props} />;
  return <LoadedRecords {...props} />;
}

function RecordsLoading() {
  return <section className="career-diary-state" aria-busy="true"><p role="status">Загружаем записи.</p><span className="career-diary-skeleton" /></section>;
}

function RecordsEmpty(props: CareerDiaryRecordListProps) {
  const title = props.tab === 'reviews' ? 'Прошлые недели' : 'Достижения для профиля';
  return (
    <section className="career-diary-empty" aria-label={title}>
      <h2 id={props.tab === 'reviews' ? 'career-diary-reviews-title' : 'career-diary-achievements-title'} tabIndex={-1}>{title} пока нет</h2>
      <p>Здесь будут сохранённые записи дневника.</p>
      {props.tab === 'achievements' && props.onAddMissingAchievement ? (
        <button className="career-btn is-primary" type="button" onClick={props.onAddMissingAchievement}>
          Добавить недостающее достижение
        </button>
      ) : null}
    </section>
  );
}

function LoadedRecords(props: CareerDiaryRecordListProps) {
  const title = props.tab === 'reviews' ? 'Прошлые недели' : 'Достижения для профиля';
  return (
    <section className="career-diary-records" aria-label={title} aria-busy={props.loadingMore}>
      <header className="career-diary-section-header">
        <h2 id={props.tab === 'reviews' ? 'career-diary-reviews-title' : 'career-diary-achievements-title'} tabIndex={-1}>{title}</h2>
        <p>{props.records.length}</p>
        {props.tab === 'achievements' && props.onAddMissingAchievement ? (
          <button className="career-btn is-primary" type="button" onClick={props.onAddMissingAchievement}>Добавить недостающее достижение</button>
        ) : null}
      </header>
      <div className="career-diary-records__list">
        {props.records.map((record) => (
          props.tab === 'reviews'
            ? <ReviewRecord key={(record as CareerDiaryWeeklyReview).weekStart} record={record as CareerDiaryWeeklyReview} />
            : <AchievementRecord
                key={(record as CareerDiaryAchievement).id}
                record={record as CareerDiaryAchievement}
                profileStatus={props.achievementProfileStatuses?.get((record as CareerDiaryAchievement).id)}
                profileStatusLoading={props.profileStatusesLoading}
                onAddToProfile={props.onAddToProfile}
                onSetStatus={props.onSetAchievementStatus}
              />
        ))}
      </div>
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

function AchievementRecord({
  record,
  profileStatus,
  profileStatusLoading = false,
  onAddToProfile,
  onSetStatus,
}: {
  readonly record: CareerDiaryAchievement;
  readonly profileStatus?: CareerDiaryAchievementProfileStatus;
  readonly profileStatusLoading?: boolean;
  readonly onAddToProfile?: (achievement: CareerDiaryAchievement) => void;
  readonly onSetStatus?: (achievementId: string, status: CareerDiaryAchievementStatus) => void;
}) {
  const status = achievementStatusText(record, profileStatus);
  const canAdd = record.status === 'ready_to_add' && !profileStatusLoading &&
    profileStatus !== 'prepared' && profileStatus !== 'added';
  return (
    <article className="career-diary-record career-diary-achievement">
      <header className="career-diary-achievement__header">
        <h3>{record.result}</h3>
        <span className="career-diary-record__state">{status}</span>
      </header>
      <dl>
        <RecordField label="Ситуация" value={record.situation} />
        <RecordField label="Действие" value={record.action} />
        <RecordField label="Результат" value={record.result} />
        <RecordField label="Записано" value={formatCareerDiaryDate(record.createdAt.slice(0, 10))} />
        <RecordField label="Источник" value="Карьерный дневник" />
      </dl>
      <div className="career-diary-achievement__actions">
        {canAdd && onAddToProfile ? (
          <button className="career-btn is-ghost" type="button" onClick={() => onAddToProfile(record)}>
            Добавить в профиль
          </button>
        ) : null}
        {record.status === 'dismissed' && onSetStatus ? (
          <button className="career-btn is-ghost" type="button" onClick={() => onSetStatus(record.id, 'ready_to_add')}>
            Вернуть в список
          </button>
        ) : null}
        {record.status === 'ready_to_add' && profileStatus === 'none' && onSetStatus ? (
          <button className="career-btn is-ghost" type="button" onClick={() => onSetStatus(record.id, 'dismissed')}>
            Не добавлять
          </button>
        ) : null}
      </div>
    </article>
  );
}

function achievementStatusText(
  record: CareerDiaryAchievement,
  profileStatus?: CareerDiaryAchievementProfileStatus,
): string {
  if (profileStatus === 'added') return 'Добавлено в профиль';
  if (profileStatus === 'prepared') return 'Ожидает принятия в профиле';
  if (profileStatus === 'reverted') return 'Правка профиля отменена';
  if (profileStatus === 'failed') return 'Правка профиля не завершена';
  return record.status === 'ready_to_add' ? 'Готово к добавлению' : 'Отложено';
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
