import { useCallback, useState } from 'react';
import { DotsThreeVertical } from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
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
import { humanSourceLabel } from './sourceLabels';
import {
  formatDayMonth,
  responseNextStep as cardNextStep,
  responseStatusPill,
} from './responseCardFace';
import { StatusIcon } from './ResponsesCard';

export interface ResponsesApplicationsTableProps {
  readonly applications: readonly ApplicationView[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelected: (id: string) => void;
  readonly onToggleAll: () => void;
  readonly onSelectAllFiltered: () => void;
  readonly onClearSelection: () => void;
  readonly allSelectedByFilter: boolean;
  readonly allowSelectAllFiltered: boolean;
  readonly pageMeta?: ApplicationListPageMeta;
  readonly query: ApplicationListQuery;
  readonly onBulkComplete: (notice: string) => void;
  readonly selectedApplicationId?: string;
  readonly onSelectApplication: (id: string) => void;
}

interface ApplicationListProps {
  readonly applications: readonly ApplicationView[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelected: (id: string) => void;
  readonly onToggleAll: () => void;
  readonly selectedApplicationId?: string;
  readonly onSelectApplication: (id: string) => void;
}

interface ApplicationRowProps {
  readonly application: ApplicationView;
  readonly selected: boolean;
  readonly active: boolean;
  readonly onToggleSelected: () => void;
  readonly onSelectApplication: () => void;
}

export function ResponsesApplicationsTable(props: ResponsesApplicationsTableProps) {
  const [bulkNotice, setBulkNotice] = useState('');
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
      <ApplicationTable {...props} />
      <MobileApplicationList {...props} />
    </section>
  );
}

function ApplicationSelectionBar(props: ResponsesApplicationsTableProps) {
  if (!props.selectedIds.size && !props.allSelectedByFilter) return null;
  return (
    <>
      <div className="career-responses-selection">
        <span role="status">
          {props.allSelectedByFilter
            ? 'Выбраны все ' + (props.pageMeta?.total ?? 0) + ' по фильтру'
            : 'Выбрано ' + props.selectedIds.size + ' на странице'}
        </span>
        {props.pageMeta && props.allowSelectAllFiltered ? (
          <button type="button" onClick={props.onSelectAllFiltered}>
            {props.allSelectedByFilter
              ? 'Снять выбор по фильтру'
              : 'Выбрать все ' + props.pageMeta.total + ' по фильтру'}
          </button>
        ) : null}
        <button type="button" onClick={props.onClearSelection}>
          Снять выбор
        </button>
      </div>
      {props.allSelectedByFilter ? (
        <ApplicationBulkActions query={props.query} onComplete={props.onBulkComplete} />
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
  readonly preview: (action: ApplicationBulkAction['type']) => void;
  readonly confirm: () => void;
}

function useApplicationBulkPreview(
  query: ApplicationListQuery,
  setBusy: (value: boolean) => void,
  setError: (value: string) => void,
  setPreviewCount: (value: number | null) => void,
) {
  const runPreview = useCallback(
    async (next: ApplicationBulkAction['type']) => {
      setBusy(true);
      setError('');
      try {
        const result = await previewApplicationBulk(
          query,
          next === 'close' ? { type: 'close' } : { type: 'retry' },
        );
        setPreviewCount(result.affectedCount);
      } catch {
        setError('Не удалось проверить состав массового действия. Повторите запрос.');
      } finally {
        setBusy(false);
      }
    },
    [query, setBusy, setError, setPreviewCount],
  );
  return useCallback((next: ApplicationBulkAction['type']) => void runPreview(next), [runPreview]);
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
  const runPreview = useApplicationBulkPreview(query, setBusy, setError, setPreviewCount);
  const preview = (next: ApplicationBulkAction['type']) => {
    setAction(next);
    runPreview(next);
  };
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

export function ApplicationBulkActions({
  query,
  onComplete,
}: {
  readonly query: ApplicationListQuery;
  readonly onComplete: (notice: string) => void;
}) {
  const controller = useApplicationBulkActions(query, onComplete);
  return (
    <div className="career-responses-bulk-actions" role="group" aria-label="Массовое действие">
      {BULK_ACTIONS.map((item) => (
        <button
          key={item.type}
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          aria-pressed={controller.action === item.type}
          disabled={controller.busy}
          onClick={() => controller.preview(item.type)}
        >
          {item.label}
        </button>
      ))}
      {controller.previewCount !== null ? (
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-sm"
          onClick={controller.confirm}
          disabled={controller.busy}
        >
          Подтвердить: {controller.previewCount}
        </button>
      ) : null}
      {controller.error ? <span role="alert">{controller.error}</span> : null}
    </div>
  );
}

const BULK_ACTIONS: readonly {
  readonly type: ApplicationBulkAction['type'];
  readonly label: string;
}[] = [
  { type: 'retry', label: 'Повторить отклик' },
  { type: 'close', label: 'Закрыть отклики' },
];

function ApplicationTable({
  applications,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  selectedApplicationId,
  onSelectApplication,
}: ApplicationListProps) {
  const allSelected = applications.length > 0 && selectedIds.size === applications.length;
  return (
    <table className="career-responses-table">
      <thead>
        <tr>
          <th scope="col" className="career-responses-table__select">
            <input
              type="checkbox"
              aria-label="Выбрать отклики на странице"
              checked={allSelected}
              onChange={onToggleAll}
            />
          </th>
          <th scope="col">Компания и роль</th>
          <th scope="col">Канал</th>
          <th scope="col">Статус</th>
          <th scope="col">Следующий шаг</th>
          <th scope="col">Срок</th>
          <th scope="col">Отправлено</th>
        </tr>
      </thead>
      <tbody>
        {applications.map((application) => (
          <ApplicationTableRow
            key={application.id}
            application={application}
            selected={selectedIds.has(application.id)}
            active={selectedApplicationId === application.id}
            onToggleSelected={() => onToggleSelected(application.id)}
            onSelectApplication={() => onSelectApplication(application.id)}
          />
        ))}
      </tbody>
    </table>
  );
}

function ApplicationTableRow({
  application,
  selected,
  active,
  onToggleSelected,
  onSelectApplication,
}: ApplicationRowProps) {
  const vacancy = application.vacancy;
  const company = vacancy?.companyHidden
    ? 'Компания скрыта'
    : vacancy?.company || 'Компания не указана';
  const dueAt =
    application.followUp?.dueAt ??
    application.followUpDueAt ??
    application.nearestInterview?.scheduledAt;
  return (
    <tr className={active ? 'is-selected' : undefined}>
      <td className="career-responses-table__select">
        <input
          type="checkbox"
          aria-label={'Выбрать ' + (vacancy?.title ?? 'Вакансию без названия') + ' · ' + company}
          checked={selected}
          onChange={onToggleSelected}
        />
      </td>
      <td className="career-responses-table__company-role">
        <button
          type="button"
          aria-label={
            'Открыть отклик: ' + (vacancy?.title ?? 'Вакансия без названия') + ', ' + company
          }
          aria-pressed={active}
          onClick={onSelectApplication}
        >
          <strong>{company}</strong>
          <span>{vacancy?.title ?? 'Вакансия без названия'}</span>
        </button>
      </td>
      <td>{humanSourceLabel(vacancy?.source)}</td>
      <td>
        <ApplicationStatusCell application={application} />
      </td>
      <td>{cardNextStep(application).text}</td>
      <td className="career-numeric">{formatDayMonth(dueAt) ?? '—'}</td>
      <td className="career-numeric">
        {formatDayMonth(application.appliedAt ?? application.createdAt) ?? '—'}
      </td>
    </tr>
  );
}

function ApplicationStatusCell({ application }: { readonly application: ApplicationView }) {
  const pill = responseStatusPill(application);
  return (
    <span className={'career-responses-status-pill is-' + pill.tone}>
      <StatusIcon tone={pill.tone} />
      {pill.label}
    </span>
  );
}

function MobileApplicationList(props: ApplicationListProps) {
  return (
    <div className="career-responses-mobile-list">
      {props.applications.map((application) => (
        <MobileApplicationCard
          key={application.id}
          application={application}
          selected={props.selectedIds.has(application.id)}
          active={props.selectedApplicationId === application.id}
          onToggleSelected={() => props.onToggleSelected(application.id)}
          onSelectApplication={() => props.onSelectApplication(application.id)}
        />
      ))}
    </div>
  );
}

function MobileApplicationCard({
  application,
  selected,
  active,
  onToggleSelected,
  onSelectApplication,
}: ApplicationRowProps) {
  const vacancy = application.vacancy;
  const company = vacancy?.companyHidden
    ? 'Компания скрыта'
    : vacancy?.company || 'Компания не указана';
  const dueAt =
    application.followUp?.dueAt ??
    application.followUpDueAt ??
    application.nearestInterview?.scheduledAt;
  return (
    <article className={'career-responses-mobile-card' + (active ? ' is-selected' : '')}>
      <div className="career-responses-mobile-card-head">
        <label>
          <input
            type="checkbox"
            aria-label={'Выбрать ' + (vacancy?.title ?? 'Вакансию без названия') + ' · ' + company}
            checked={selected}
            onChange={onToggleSelected}
          />
          <span>{tableStageLabel(application.stage)}</span>
        </label>
        <button
          type="button"
          aria-label={
            'Открыть отклик: ' + (vacancy?.title ?? 'Вакансия без названия') + ', ' + company
          }
          aria-pressed={active}
          onClick={onSelectApplication}
        >
          <DotsThreeVertical aria-hidden="true" />
        </button>
      </div>
      <strong>{company}</strong>
      <span>{vacancy?.title ?? 'Вакансия без названия'}</span>
      <p>
        {humanSourceLabel(vacancy?.source)} · {responseNextStep(application)}
      </p>
      <small>{dueAt ? 'Срок: ' + formatDate(dueAt) : 'Срок шага не указан'}</small>
    </article>
  );
}

function responseNextStep(application: ApplicationView): string {
  if (application.nearestInterview?.scheduledAt) return 'Подготовиться к интервью';
  if (application.followUp?.urgency === 'overdue' || application.followUp?.urgency === 'stale') {
    return 'Напомнить компании';
  }
  if (application.followUp?.urgency === 'due') return 'Напомнить о себе сегодня';
  if (application.whoseTurn === 'company') return 'Ждём ответа';
  return 'Выбрать следующий шаг';
}

/** Mockup 5 at 390: the row date is «08.10», without the year. */
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU');
}

function tableStageLabel(stage: ApplicationStage): string {
  const labels: Record<ApplicationStage, string> = {
    saved: 'Черновик',
    applied: 'Отправлено',
    responded: 'Ответили',
    interview: 'Интервью',
    offer: 'Оффер',
    rejected: 'Отказ',
    archived: 'Архив',
  };
  return labels[stage];
}
