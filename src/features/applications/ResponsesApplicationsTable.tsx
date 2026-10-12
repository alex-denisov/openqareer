import { useCallback, useState } from 'react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import { APPLICATION_STAGES } from '../../../shared/applicationStage';
import type {
  ApplicationListPageMeta,
  ApplicationListQuery,
  ApplicationView,
} from './applicationsApi';
import {
  executeApplicationBulk,
  previewApplicationBulk,
  type ApplicationBulkAction,
} from './applicationsApi';
import type { UseApplications } from './useApplications';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { ResponsesCard } from './ResponsesCard';

export interface ResponsesApplicationsTableProps {
  readonly applications: readonly ApplicationView[];
  readonly state: UseApplications;
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelected: (id: string) => void;
  readonly onToggleAll: () => void;
  readonly onSelectAllFiltered: () => void;
  readonly allSelectedByFilter: boolean;
  readonly pageMeta?: ApplicationListPageMeta;
  readonly query: ApplicationListQuery;
  readonly onOpenAutomation: () => void;
  readonly onBulkComplete: (notice: string) => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly onOpenOfferEdit?: (applicationId: string) => void;
}

interface ApplicationListProps {
  readonly applications: readonly ApplicationView[];
  readonly state: UseApplications;
  readonly selectedIds: ReadonlySet<string>;
  readonly expandedId: string | null;
  readonly onToggleSelected: (id: string) => void;
  readonly onToggleExpanded: (id: string) => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly onOpenOfferEdit?: (applicationId: string) => void;
}

interface ApplicationRowProps {
  readonly application: ApplicationView;
  readonly state: UseApplications;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly onToggleSelected: () => void;
  readonly onToggleExpanded: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly onOpenOfferEdit?: (applicationId: string) => void;
}

export function ResponsesApplicationsTable(props: ResponsesApplicationsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState('');
  const toggleExpanded = (id: string) => setExpandedId((current) => (current === id ? null : id));
  const handleBulkComplete = (notice: string) => {
    setBulkNotice(notice);
    props.onBulkComplete(notice);
  };
  return (
    <section className="career-responses-table-wrap" aria-label="Отклики таблицей">
      <ApplicationSelectionBar {...props} onBulkComplete={handleBulkComplete} />
      {bulkNotice ? (
        <p className="career-responses-bulk-notice" role="status">
          {bulkNotice}
        </p>
      ) : null}
      <ApplicationTable
        applications={props.applications}
        state={props.state}
        selectedIds={props.selectedIds}
        expandedId={expandedId}
        onToggleSelected={props.onToggleSelected}
        onToggleExpanded={toggleExpanded}
        onOpenExpert={props.onOpenExpert}
        onOpenOfferEdit={props.onOpenOfferEdit}
      />
      <MobileApplicationList
        applications={props.applications}
        state={props.state}
        selectedIds={props.selectedIds}
        expandedId={expandedId}
        onToggleSelected={props.onToggleSelected}
        onToggleExpanded={toggleExpanded}
        onOpenExpert={props.onOpenExpert}
        onOpenOfferEdit={props.onOpenOfferEdit}
      />
    </section>
  );
}

function ApplicationSelectionBar(props: ResponsesApplicationsTableProps) {
  return (
    <>
      <div className="career-responses-selection">
        <label>
          <input
            type="checkbox"
            checked={
              props.applications.length > 0 && props.selectedIds.size === props.applications.length
            }
            onChange={props.onToggleAll}
          />
          Выбрать на странице
        </label>
        {props.pageMeta ? (
          <button type="button" onClick={props.onSelectAllFiltered}>
            {props.allSelectedByFilter
              ? 'Снять выбор по фильтру'
              : 'Выбрать все ' + props.pageMeta.total + ' по фильтру'}
          </button>
        ) : null}
        {props.allSelectedByFilter ? (
          <span role="status">Выбраны все {props.pageMeta?.total ?? 0} по фильтру</span>
        ) : props.selectedIds.size ? (
          <span role="status">Выбрано {props.selectedIds.size}</span>
        ) : null}
      </div>
      {props.allSelectedByFilter ? (
        <ApplicationBulkActions query={props.query} onComplete={props.onBulkComplete} />
      ) : null}
      {props.selectedIds.size > 0 && !props.allSelectedByFilter ? (
        <div className="career-responses-selection-actions">
          <span>Действия с отправкой требуют подтверждения.</span>
          <button type="button" onClick={props.onOpenAutomation}>
            Одобрить
          </button>
        </div>
      ) : null}
    </>
  );
}

interface BulkActionController {
  readonly action: ApplicationBulkAction['type'];
  readonly setAction: (action: ApplicationBulkAction['type']) => void;
  readonly previewCount: number | null;
  readonly error: string;
  readonly busy: boolean;
  readonly preview: () => void;
  readonly confirm: () => void;
}

function useApplicationBulkPreview(
  query: ApplicationListQuery,
  action: ApplicationBulkAction['type'],
  setBusy: (value: boolean) => void,
  setError: (value: string) => void,
  setPreviewCount: (value: number | null) => void,
) {
  const runPreview = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await previewApplicationBulk(
        query,
        action === 'close' ? { type: 'close' } : { type: 'retry' },
      );
      setPreviewCount(result.affectedCount);
    } catch {
      setError('Не удалось проверить состав массового действия. Повторите запрос.');
    } finally {
      setBusy(false);
    }
  }, [action, query, setBusy, setError, setPreviewCount]);
  return useCallback(() => void runPreview(), [runPreview]);
}

function useApplicationBulkConfirm(
  query: ApplicationListQuery,
  action: ApplicationBulkAction['type'],
  previewCount: number | null,
  onComplete: (notice: string) => void,
  setBusy: (value: boolean) => void,
  setError: (value: string) => void,
  setPreviewCount: (value: number | null) => void,
) {
  const runConfirm = useCallback(async () => {
    if (previewCount === null) return;
    setBusy(true);
    setError('');
    try {
      const result = await executeApplicationBulk(
        query,
        action === 'close' ? { type: 'close' } : { type: 'retry' },
        previewCount,
      );
      const notice =
        result.state === 'prepared'
          ? 'В очередь подготовлено ' +
            (result.preparedCount ?? 0) +
            '; отправлено ' +
            (result.sentCount ?? 0) +
            '.'
          : 'Закрыто ' + result.changedCount + ' откликов.';
      setPreviewCount(null);
      onComplete(notice);
    } catch {
      setError('Список изменился или действие не выполнено. Обновите фильтр и проверьте ещё раз.');
      setPreviewCount(null);
    } finally {
      setBusy(false);
    }
  }, [action, onComplete, previewCount, query, setBusy, setError, setPreviewCount]);
  return useCallback(() => void runConfirm(), [runConfirm]);
}

function useApplicationBulkActions(
  query: ApplicationListQuery,
  onComplete: (notice: string) => void,
): BulkActionController {
  const [action, setAction] = useState<ApplicationBulkAction['type']>('close');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useApplicationBulkPreview(query, action, setBusy, setError, setPreviewCount);
  const confirm = useApplicationBulkConfirm(
    query,
    action,
    previewCount,
    onComplete,
    setBusy,
    setError,
    setPreviewCount,
  );
  return { action, setAction, previewCount, error, busy, preview, confirm };
}

function ApplicationBulkActions({
  query,
  onComplete,
}: {
  readonly query: ApplicationListQuery;
  readonly onComplete: (notice: string) => void;
}) {
  const controller = useApplicationBulkActions(query, onComplete);
  return (
    <div className="career-responses-bulk-actions" aria-label="Массовое действие">
      <label>
        Действие
        <select
          value={controller.action}
          onChange={(event) =>
            controller.setAction(event.currentTarget.value as ApplicationBulkAction['type'])
          }
        >
          <option value="close">Закрыть отклики</option>
          <option value="retry">Подготовить повторы</option>
        </select>
      </label>
      <button type="button" onClick={controller.preview} disabled={controller.busy}>
        {controller.busy ? 'Проверяем' : 'Проверить'}
      </button>
      {controller.previewCount !== null ? (
        <button type="button" onClick={controller.confirm} disabled={controller.busy}>
          Подтвердить {controller.previewCount}
        </button>
      ) : null}
      {controller.error ? <span role="alert">{controller.error}</span> : null}
    </div>
  );
}

function ApplicationTable({
  applications,
  state,
  selectedIds,
  expandedId,
  onToggleSelected,
  onToggleExpanded,
  onOpenExpert,
  onOpenOfferEdit,
}: ApplicationListProps) {
  return (
    <table className="career-responses-table">
      <thead>
        <tr>
          <th scope="col">Выбор</th>
          <th scope="col">Компания</th>
          <th scope="col">Роль</th>
          <th scope="col">Этап</th>
          <th scope="col">Источник</th>
          <th scope="col">Следующий шаг</th>
          <th scope="col">Действия</th>
        </tr>
      </thead>
      <tbody>
        {applications.map((application) => (
          <ApplicationTableRow
            key={application.id}
            application={application}
            state={state}
            selected={selectedIds.has(application.id)}
            expanded={expandedId === application.id}
            onToggleSelected={() => onToggleSelected(application.id)}
            onToggleExpanded={() => onToggleExpanded(application.id)}
            onOpenExpert={onOpenExpert}
            onOpenOfferEdit={onOpenOfferEdit}
          />
        ))}
      </tbody>
    </table>
  );
}

function ApplicationTableRow(props: ApplicationRowProps) {
  return (
    <>
      <ApplicationTableCells {...props} />
      {props.expanded ? (
        <ApplicationDetailsRow
          application={props.application}
          state={props.state}
          onOpenExpert={props.onOpenExpert}
          onOpenOfferEdit={props.onOpenOfferEdit}
        />
      ) : null}
    </>
  );
}

function ApplicationTableCells({
  application,
  selected,
  onToggleSelected,
  onToggleExpanded,
  expanded,
  state,
}: ApplicationRowProps) {
  const title = application.vacancy?.title ?? 'Вакансия без названия';
  const company = application.vacancy?.companyHidden
    ? 'Компания скрыта'
    : application.vacancy?.company || 'Компания не указана';
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          aria-label={'Выбрать ' + title + ' · ' + company}
          checked={selected}
          onChange={onToggleSelected}
        />
      </td>
      <td>{company}</td>
      <td>{title}</td>
      <ApplicationStageCell application={application} state={state} />
      <td>{application.vacancy?.source || 'Источник не указан'}</td>
      <td>
        {application.followUpDueAt
          ? new Date(application.followUpDueAt).toLocaleDateString('ru-RU')
          : 'Следующий шаг не задан'}
      </td>
      <td>
        <button type="button" aria-expanded={expanded} onClick={onToggleExpanded}>
          {expanded ? 'Скрыть' : 'Действия'}
        </button>
      </td>
    </tr>
  );
}

function ApplicationStageCell({
  application,
  state,
}: {
  readonly application: ApplicationView;
  readonly state: UseApplications;
}) {
  return (
    <td>
      <select
        aria-label={'Этап: ' + (application.vacancy?.title ?? 'Вакансия без названия')}
        value={application.stage}
        onChange={(event) =>
          state.changeStage(
            application.id,
            event.currentTarget.value as ApplicationStage,
            new Date().toISOString(),
          )
        }
      >
        {APPLICATION_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {tableStageLabel(stage)}
          </option>
        ))}
      </select>
    </td>
  );
}

function MobileApplicationList(props: ApplicationListProps) {
  return (
    <div className="career-responses-mobile-list">
      {props.applications.map((application) => (
        <MobileApplicationCard
          key={application.id}
          application={application}
          state={props.state}
          selected={props.selectedIds.has(application.id)}
          expanded={props.expandedId === application.id}
          onToggleSelected={() => props.onToggleSelected(application.id)}
          onToggleExpanded={() => props.onToggleExpanded(application.id)}
          onOpenExpert={props.onOpenExpert}
          onOpenOfferEdit={props.onOpenOfferEdit}
        />
      ))}
    </div>
  );
}

function MobileApplicationCard(props: {
  readonly application: ApplicationView;
  readonly state: UseApplications;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly onToggleSelected: () => void;
  readonly onToggleExpanded: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
  readonly onOpenOfferEdit?: (applicationId: string) => void;
}) {
  const title = props.application.vacancy?.title ?? 'Вакансия без названия';
  const company = props.application.vacancy?.companyHidden
    ? 'Компания скрыта'
    : props.application.vacancy?.company || 'Компания не указана';
  return (
    <article className="career-responses-mobile-card">
      <div className="career-responses-mobile-card-head">
        <label>
          <input
            type="checkbox"
            aria-label={'Выбрать ' + title + ' · ' + company}
            checked={props.selected}
            onChange={props.onToggleSelected}
          />
          <span>{tableStageLabel(props.application.stage)}</span>
        </label>
        <button type="button" aria-expanded={props.expanded} onClick={props.onToggleExpanded}>
          {props.expanded ? 'Скрыть' : 'Действия'}
        </button>
      </div>
      <strong>{title}</strong>
      <span>{company}</span>
      <p>
        {props.application.vacancy?.source || 'Источник не указан'} ·{' '}
        {props.application.followUpDueAt
          ? new Date(props.application.followUpDueAt).toLocaleDateString('ru-RU')
          : 'Следующий шаг не задан'}
      </p>
      {props.expanded ? <MobileApplicationCardActions {...props} /> : null}
    </article>
  );
}

function MobileApplicationCardActions({
  application,
  state,
  onOpenExpert,
  onOpenOfferEdit,
}: Pick<
  Parameters<typeof MobileApplicationCard>[0],
  'application' | 'state' | 'onOpenExpert' | 'onOpenOfferEdit'
>) {
  return (
    <ResponsesCard
      application={application}
      failed={state.failedChanges.has(application.id)}
      conflicted={state.conflicts.has(application.id)}
      onOpenExpert={onOpenExpert}
      onChangeStage={(stage, occurredAt, receipt) =>
        state.changeStage(application.id, stage, occurredAt, receipt)
      }
      onScheduleInterview={(scheduledAt) => state.scheduleInterview(application.id, scheduledAt)}
      onRetry={() => state.retryStageChange(application.id)}
      onRefresh={state.reload}
      onSaveNote={(notes) => state.saveNote(application.id, notes)}
      onMarkFollowUpSent={() => state.markFollowUpSent(application.id)}
      onSkip={(reasonId) => void state.skip(application, reasonId)}
      onOpenOfferEdit={onOpenOfferEdit}
    />
  );
}

function ApplicationDetailsRow({
  application,
  state,
  onOpenExpert,
  onOpenOfferEdit,
}: Pick<ApplicationRowProps, 'application' | 'state' | 'onOpenExpert' | 'onOpenOfferEdit'>) {
  return (
    <tr>
      <td colSpan={7}>
        <ResponsesCard
          application={application}
          failed={state.failedChanges.has(application.id)}
          conflicted={state.conflicts.has(application.id)}
          onOpenExpert={onOpenExpert}
          onChangeStage={(stage, occurredAt, receipt) =>
            state.changeStage(application.id, stage, occurredAt, receipt)
          }
          onScheduleInterview={(scheduledAt) =>
            state.scheduleInterview(application.id, scheduledAt)
          }
          onRetry={() => state.retryStageChange(application.id)}
          onRefresh={state.reload}
          onSaveNote={(notes) => state.saveNote(application.id, notes)}
          onMarkFollowUpSent={() => state.markFollowUpSent(application.id)}
          onSkip={(reasonId) => void state.skip(application, reasonId)}
          onOpenOfferEdit={onOpenOfferEdit}
        />
      </td>
    </tr>
  );
}

function tableStageLabel(stage: ApplicationStage): string {
  const labels: Record<ApplicationStage, string> = {
    saved: 'Хочу',
    applied: 'Пробовали отправить',
    responded: 'Ответили',
    interview: 'Интервью',
    offer: 'Оффер',
    rejected: 'Отказ',
    archived: 'Архив',
  };
  return labels[stage];
}
