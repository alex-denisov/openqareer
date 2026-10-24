import { useCallback, useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowRight,
  Briefcase,
  CalendarBlank,
  ChatCircleDots,
  CheckCircle,
  DotsThreeVertical,
  EnvelopeSimple,
  NotePencil,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { deliveryState, type ApplicationStage } from '../../../shared/applicationStage';
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
import { CandidateActionPanel } from './CandidateActionPanel';
import { countResponsesNeedingAction, isResponseNeedingAction } from './responsesFiltering';
import { ResponsesMobileLinks } from './ResponsesMobileLinks';
import { humanSourceLabel } from './sourceLabels';
import { waitingLabel } from './waitingLabel';

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

export interface ResponsesMobileFeedProps {
  readonly applications: readonly ApplicationView[];
  readonly allApplications: readonly ApplicationView[];
  readonly visibleLimit: number;
  readonly onLoadMore: () => void;
  readonly onSelectApplication: (id: string) => void;
  readonly onRefreshApplications?: () => void | Promise<unknown>;
}

export function ResponsesMobileFeed(props: ResponsesMobileFeedProps) {
  const [manualSelectionOpen, setManualSelectionOpen] = useState(false);
  const mobileLinks = (
    <ResponsesMobileLinks
      applications={props.applications}
      allApplications={props.allApplications}
    />
  );
  if (props.applications.length === 0) {
    return (
      <section className="career-responses-mobile-feed" aria-label="Список откликов">
        {mobileLinks}
      </section>
    );
  }
  const visible = props.applications.slice(0, props.visibleLimit);
  const needsAction = visible.filter(isResponseNeedingAction);
  const dueByStep = visible.filter((application) => !isResponseNeedingAction(application));
  return (
    <section className="career-responses-mobile-feed" aria-label="Список откликов">
      <MobileActionGroup
        applications={props.applications}
        visibleApplications={needsAction}
        count={countResponsesNeedingAction(props.applications)}
        manualSelectionOpen={manualSelectionOpen}
        onToggleManualSelection={() => setManualSelectionOpen((open) => !open)}
        onSelectApplication={props.onSelectApplication}
        onRefreshApplications={props.onRefreshApplications}
      />
      <MobileDueGroup applications={dueByStep} onSelectApplication={props.onSelectApplication} />
      <MobileFeedFooter
        shown={visible.length}
        total={props.applications.length}
        onLoadMore={props.onLoadMore}
      />
      {mobileLinks}
    </section>
  );
}

function MobileActionGroupHeader({
  count,
  manualSelectionOpen,
  onToggleManualSelection,
}: {
  readonly count: number;
  readonly manualSelectionOpen: boolean;
  readonly onToggleManualSelection: () => void;
}) {
  return (
    <header className="career-responses-mobile-group-header">
      <h2 id="career-responses-mobile-action-title">
        Нужно действие · {count.toLocaleString('ru-RU')}
      </h2>
      {count > 0 ? (
        <button
          type="button"
          aria-controls="career-responses-mobile-manual-send"
          aria-expanded={manualSelectionOpen}
          aria-pressed={manualSelectionOpen}
          onClick={onToggleManualSelection}
        >
          {manualSelectionOpen ? 'Скрыть выбор' : 'Выбрать'}
        </button>
      ) : null}
    </header>
  );
}

function MobileActionGroup({
  applications,
  visibleApplications,
  count,
  manualSelectionOpen,
  onToggleManualSelection,
  onSelectApplication,
  onRefreshApplications,
}: {
  readonly applications: readonly ApplicationView[];
  readonly visibleApplications: readonly ApplicationView[];
  readonly count: number;
  readonly manualSelectionOpen: boolean;
  readonly onToggleManualSelection: () => void;
  readonly onSelectApplication: (id: string) => void;
  readonly onRefreshApplications?: () => void | Promise<unknown>;
}) {
  return (
    <section
      className="career-responses-mobile-group"
      aria-labelledby="career-responses-mobile-action-title"
    >
      <MobileActionGroupHeader
        count={count}
        manualSelectionOpen={manualSelectionOpen}
        onToggleManualSelection={onToggleManualSelection}
      />
      <div id="career-responses-mobile-manual-send" hidden={!manualSelectionOpen}>
        {manualSelectionOpen ? (
          <CandidateActionPanel
            applications={applications}
            onRefreshApplications={onRefreshApplications}
          />
        ) : null}
      </div>
      <MobileResponseList
        label="Нужно действие"
        applications={visibleApplications}
        onSelectApplication={onSelectApplication}
      />
    </section>
  );
}

function MobileDueGroup({
  applications,
  onSelectApplication,
}: {
  readonly applications: readonly ApplicationView[];
  readonly onSelectApplication: (id: string) => void;
}) {
  if (applications.length === 0) return null;
  return (
    <section
      className="career-responses-mobile-group"
      aria-labelledby="career-responses-mobile-due-title"
    >
      <header className="career-responses-mobile-group-header">
        <h2 id="career-responses-mobile-due-title">По сроку шага</h2>
      </header>
      <MobileResponseList
        label="По сроку шага"
        applications={applications}
        onSelectApplication={onSelectApplication}
      />
    </section>
  );
}

function MobileResponseList({
  label,
  applications,
  onSelectApplication,
}: {
  readonly label: string;
  readonly applications: readonly ApplicationView[];
  readonly onSelectApplication: (id: string) => void;
}) {
  if (applications.length === 0) return null;
  return (
    <ul className="career-responses-mobile-list" aria-label={label}>
      {applications.map((application) => (
        <MobileResponseRow
          key={application.id}
          application={application}
          onSelectApplication={() => onSelectApplication(application.id)}
        />
      ))}
    </ul>
  );
}

function MobileResponseRow({
  application,
  onSelectApplication,
}: {
  readonly application: ApplicationView;
  readonly onSelectApplication: () => void;
}) {
  const vacancy = application.vacancy;
  const company = vacancy?.companyHidden
    ? 'Компания скрыта'
    : vacancy?.company || 'Компания не указана';
  const nextStep = mobileResponseNextStepLabel(application);
  return (
    <li className="career-responses-mobile-row-item">
      <article className="career-responses-mobile-row">
        <div className="career-responses-mobile-row-heading">
          <strong>{company}</strong>
          <time className="career-numeric" dateTime={application.createdAt}>
            {formatShortDate(application.createdAt)}
          </time>
        </div>
        <p className="career-responses-mobile-row-role">
          <span>{vacancy?.title ?? 'Вакансия без названия'}</span>
          <span aria-hidden="true"> · </span>
          <span>{humanSourceLabel(vacancy?.source)}</span>
        </p>
        <div className="career-responses-mobile-row-footer">
          <p className="career-responses-mobile-row-status">
            {mobileResponseStatusIcon(application)}
            <span>{mobileResponseStatusLabel(application)}</span>
          </p>
          <button
            type="button"
            className="career-responses-mobile-row-next"
            aria-label={'Открыть следующий шаг: ' + nextStep + ' · ' + company}
            onClick={onSelectApplication}
          >
            <span>{nextStep}</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </article>
    </li>
  );
}

function mobileResponseNextStepLabel(application: ApplicationView): string {
  const step = waitingLabel({
    stage: application.stage,
    whoseTurn: application.whoseTurn,
    hasMaterials: application.materials.coverLetter || application.materials.resume,
    followUp: application.followUp,
    nearestInterviewNeedsPrep:
      application.nearestInterview !== null && application.nearestInterview.prepStatus !== 'ready',
    closedReason: application.closedReason,
  }).text;
  if (step === 'Напоминание компании просрочено') return 'Напомнить рекрутеру';
  if (step.startsWith('Напоминание компании сегодня')) return 'Напомнить сегодня';
  if (step === 'Подготовиться к интервью') return 'Подготовиться';
  if (step === 'Соберите письмо') return 'Собрать письмо';
  if (step === 'Примите решение по офферу') return 'Решить по офферу';
  if (step === 'Ждём ответа компании' || step.startsWith('Отправлен · рано')) return 'Ждать ответа';
  if (step === 'Ваш ход') return 'Выбрать шаг';
  return step;
}

function mobileResponseStatusIcon(application: ApplicationView): ReactNode {
  if (application.stage === 'saved') return <NotePencil aria-hidden="true" />;
  if (application.stage === 'applied') {
    const state = deliveryState(application.stage, application.deliveryReceipt ?? null);
    if (state === 'delivered') return <CheckCircle aria-hidden="true" />;
    if (state === 'failed') return <WarningCircle aria-hidden="true" />;
    return <EnvelopeSimple aria-hidden="true" />;
  }
  if (application.stage === 'responded') return <ChatCircleDots aria-hidden="true" />;
  if (application.stage === 'interview') return <CalendarBlank aria-hidden="true" />;
  if (application.stage === 'offer') return <Briefcase aria-hidden="true" />;
  if (application.stage === 'rejected') return <XCircle aria-hidden="true" />;
  return <Archive aria-hidden="true" />;
}

function mobileResponseStatusLabel(application: ApplicationView): string {
  if (application.stage === 'applied') {
    return deliveryStateLabel(
      deliveryState(application.stage, application.deliveryReceipt ?? null),
    );
  }
  if (application.stage === 'interview' && application.nearestInterview?.scheduledAt) {
    return 'Интервью ' + formatInterviewDateTime(application.nearestInterview.scheduledAt);
  }
  if (
    (application.stage === 'responded' || application.stage === 'offer') &&
    application.stageChangedAt
  ) {
    return tableStageLabel(application.stage) + ' ' + formatDate(application.stageChangedAt);
  }
  return tableStageLabel(application.stage);
}

function formatInterviewDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function MobileFeedFooter({
  shown,
  total,
  onLoadMore,
}: {
  readonly shown: number;
  readonly total: number;
  readonly onLoadMore: () => void;
}) {
  return (
    <footer className="career-responses-mobile-feed-footer">
      <p role="status">
        Показано {shown.toLocaleString('ru-RU')} из {total.toLocaleString('ru-RU')}. Статусы
        доставки учитывают только квитанции, сохранённые в откликах.
      </p>
      {shown < total ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onLoadMore}>
          Показать ещё 20
        </button>
      ) : null}
    </footer>
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
          <th scope="col">
            <span className="career-sr-only">Действия</span>
          </th>
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
  const delivery = deliveryState(application.stage, application.deliveryReceipt ?? null);
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
        <strong>{company}</strong>
        <span>{vacancy?.title ?? 'Вакансия без названия'}</span>
      </td>
      <td>{humanSourceLabel(vacancy?.source)}</td>
      <td>
        <ApplicationStatusCell application={application} delivery={delivery} />
      </td>
      <td>{responseNextStep(application)}</td>
      <td className="career-numeric">{dueAt ? formatDate(dueAt) : '—'}</td>
      <td className="career-numeric">{formatDate(application.createdAt)}</td>
      <ResponseActionCell
        title={vacancy?.title ?? 'Вакансия без названия'}
        company={company}
        active={active}
        onSelect={onSelectApplication}
      />
    </tr>
  );
}

function ResponseActionCell({
  title,
  company,
  active,
  onSelect,
}: {
  readonly title: string;
  readonly company: string;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <td className="career-responses-table__action">
      <button
        type="button"
        aria-label={'Открыть отклик: ' + title + ', ' + company}
        aria-pressed={active}
        onClick={onSelect}
      >
        <DotsThreeVertical aria-hidden="true" />
      </button>
    </td>
  );
}

function ApplicationStatusCell({
  application,
  delivery,
}: {
  readonly application: ApplicationView;
  readonly delivery: ReturnType<typeof deliveryState>;
}) {
  return (
    <>
      <span className={'career-responses-status is-' + application.stage}>
        {tableStageLabel(application.stage)}
      </span>
      {application.stage === 'applied' ? (
        <small className={'career-responses-status-note is-' + delivery}>
          {deliveryStateLabel(delivery)}
        </small>
      ) : null}
    </>
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

function deliveryStateLabel(state: ReturnType<typeof deliveryState>): string {
  if (state === 'delivered') return 'Доставка подтверждена';
  if (state === 'failed') return 'Не доставлено';
  if (state === 'prepared') return 'Черновик';
  return 'Пробовали отправить';
}

/** Mockup 5 at 390: the row date is «08.10», without the year. */
function formatShortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

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
