import { useState, type ReactNode } from 'react';
import {
  Archive,
  Briefcase,
  CalendarBlank,
  CaretDown,
  ChatCircleDots,
  CheckCircle,
  Circle,
  EnvelopeSimple,
  NotePencil,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { deliveryState } from '../../../shared/applicationStage';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import { CandidateActionPanel } from './CandidateActionPanel';
import { ApplicationBulkActions } from './ResponsesApplicationsTable';
import { ResponsesMobileLinks } from './ResponsesMobileLinks';
import { countResponsesNeedingAction, isResponseNeedingAction } from './responsesFiltering';
import { mobileDueDate, mobileNextStep, mobileStatusLabel } from './responsesMobileRow';
import { humanSourceLabel } from './sourceLabels';

export interface ResponsesMobileSelection {
  readonly selectedIds: ReadonlySet<string>;
  readonly allSelectedByFilter: boolean;
  readonly query: ApplicationListQuery;
  readonly onToggleSelected: (id: string) => void;
  readonly onToggleAllFiltered: () => void;
  readonly onClearSelection: () => void;
  readonly onBulkComplete: (notice: string) => void;
}

export interface ResponsesMobileFeedProps {
  readonly applications: readonly ApplicationView[];
  readonly allApplications: readonly ApplicationView[];
  readonly visibleLimit: number;
  readonly onLoadMore: () => void;
  readonly onOpenApplication: (id: string) => void;
  readonly onOpenChannels: () => void;
  readonly onOpenClosed: () => void;
  readonly onRefreshApplications?: () => void | Promise<unknown>;
  readonly selection: ResponsesMobileSelection;
  /** Shown above the list outside selection mode (the automation row). */
  readonly header?: ReactNode;
}

interface RowMode {
  readonly selecting: boolean;
  readonly selection: ResponsesMobileSelection;
  readonly onOpenApplication: (id: string) => void;
}

export function ResponsesMobileFeed(props: ResponsesMobileFeedProps) {
  const [selecting, setSelecting] = useState(false);
  const mobileLinks = <ResponsesMobileLinks {...props} />;
  if (props.applications.length === 0) {
    return (
      <section className="career-responses-mobile-feed" aria-label="Список откликов">
        {props.header}
        {mobileLinks}
      </section>
    );
  }
  const stopSelecting = () => {
    props.selection.onClearSelection();
    setSelecting(false);
  };
  const mode: RowMode = {
    selecting,
    selection: props.selection,
    onOpenApplication: props.onOpenApplication,
  };
  return (
    <section className="career-responses-mobile-feed" aria-label="Список откликов">
      {selecting ? (
        <MobileSelectionBar
          total={props.applications.length}
          applications={props.applications}
          selection={props.selection}
          onCancel={stopSelecting}
          onRefreshApplications={props.onRefreshApplications}
        />
      ) : (
        props.header
      )}
      <MobileFeedLists
        applications={props.applications}
        visible={props.applications.slice(0, props.visibleLimit)}
        mode={mode}
        onStartSelection={selecting ? undefined : () => setSelecting(true)}
        onLoadMore={props.onLoadMore}
      />
      {mobileLinks}
    </section>
  );
}

function MobileFeedLists({
  applications,
  visible,
  mode,
  onStartSelection,
  onLoadMore,
}: {
  readonly applications: readonly ApplicationView[];
  readonly visible: readonly ApplicationView[];
  readonly mode: RowMode;
  readonly onStartSelection?: () => void;
  readonly onLoadMore: () => void;
}) {
  const actionCount = countResponsesNeedingAction(applications).toLocaleString('ru-RU');
  return (
    <>
      <MobileGroup
        titleId="career-responses-mobile-action-title"
        title={'Нужно действие · ' + actionCount}
        label="Нужно действие"
        applications={visible.filter(isResponseNeedingAction)}
        mode={mode}
        onStartSelection={onStartSelection}
      />
      <MobileGroup
        titleId="career-responses-mobile-due-title"
        title="По сроку шага"
        label="По сроку шага"
        applications={visible.filter((application) => !isResponseNeedingAction(application))}
        mode={mode}
        hideWhenEmpty
      />
      <MobileFeedFooter
        shown={visible.length}
        total={applications.length}
        onLoadMore={onLoadMore}
      />
    </>
  );
}

function MobileSelectionBar({
  total,
  applications,
  selection,
  onCancel,
  onRefreshApplications,
}: {
  readonly total: number;
  readonly applications: readonly ApplicationView[];
  readonly selection: ResponsesMobileSelection;
  readonly onCancel: () => void;
  readonly onRefreshApplications?: () => void | Promise<unknown>;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const count = selection.allSelectedByFilter ? total : selection.selectedIds.size;
  return (
    <div className="career-responses-mobile-selection">
      <div className="career-responses-mobile-selectbar" role="toolbar" aria-label="Выбор откликов">
        <button type="button" className="career-responses-mobile-select-cancel" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="career-responses-mobile-select-all"
          aria-pressed={selection.allSelectedByFilter}
          onClick={selection.onToggleAllFiltered}
        >
          Все
        </button>
        <span role="status">Выбрано {count.toLocaleString('ru-RU')}</span>
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-sm"
          aria-expanded={actionsOpen}
          aria-controls="career-responses-mobile-actions"
          onClick={() => setActionsOpen((open) => !open)}
        >
          Действия
          <CaretDown aria-hidden="true" />
        </button>
      </div>
      <MobileSelectionActions
        open={actionsOpen}
        applications={applications}
        selection={selection}
        onRefreshApplications={onRefreshApplications}
      />
    </div>
  );
}

function MobileSelectionActions({
  open,
  applications,
  selection,
  onRefreshApplications,
}: {
  readonly open: boolean;
  readonly applications: readonly ApplicationView[];
  readonly selection: ResponsesMobileSelection;
  readonly onRefreshApplications?: () => void | Promise<unknown>;
}) {
  return (
    <section
      id="career-responses-mobile-actions"
      className="career-responses-mobile-actions"
      aria-label="Действия с выбранными"
      hidden={!open}
    >
      {open ? (
        <>
          {selection.allSelectedByFilter ? (
            <ApplicationBulkActions query={selection.query} onComplete={selection.onBulkComplete} />
          ) : (
            <p>Закрыть или повторить можно все отклики по фильтру: нажмите «Все».</p>
          )}
          <CandidateActionPanel
            applications={applications}
            onRefreshApplications={onRefreshApplications}
          />
        </>
      ) : null}
    </section>
  );
}

function MobileGroup({
  titleId,
  title,
  label,
  applications,
  mode,
  onStartSelection,
  hideWhenEmpty = false,
}: {
  readonly titleId: string;
  readonly title: string;
  readonly label: string;
  readonly applications: readonly ApplicationView[];
  readonly mode: RowMode;
  readonly onStartSelection?: () => void;
  readonly hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && applications.length === 0) return null;
  return (
    <section className="career-responses-mobile-group" aria-labelledby={titleId}>
      <header className="career-responses-mobile-group-header">
        <h2 id={titleId}>{title}</h2>
        {onStartSelection ? (
          <button type="button" onClick={onStartSelection}>
            Выбрать
          </button>
        ) : null}
      </header>
      {applications.length > 0 ? (
        <ul className="career-responses-mobile-list" aria-label={label}>
          {applications.map((application) => (
            <MobileResponseRow key={application.id} application={application} mode={mode} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function companyName(application: ApplicationView): string {
  const vacancy = application.vacancy;
  return vacancy?.companyHidden ? 'Компания скрыта' : vacancy?.company || 'Компания не указана';
}

function MobileResponseRow({
  application,
  mode,
}: {
  readonly application: ApplicationView;
  readonly mode: RowMode;
}) {
  const company = companyName(application);
  const title = application.vacancy?.title ?? 'Вакансия без названия';
  const checked =
    mode.selection.allSelectedByFilter || mode.selection.selectedIds.has(application.id);
  const content = (
    <MobileRowContent application={application} selecting={mode.selecting} checked={checked} />
  );
  return (
    <li className="career-responses-mobile-row-item">
      {mode.selecting ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={'Выбрать: ' + company + ', ' + title}
          className="career-responses-mobile-row"
          disabled={mode.selection.allSelectedByFilter}
          onClick={() => mode.selection.onToggleSelected(application.id)}
        >
          {content}
        </button>
      ) : (
        <button
          type="button"
          className="career-responses-mobile-row"
          aria-label={'Открыть отклик: ' + company + ', ' + title}
          data-application-id={application.id}
          onClick={() => mode.onOpenApplication(application.id)}
        >
          {content}
        </button>
      )}
    </li>
  );
}

function MobileRowContent({
  application,
  selecting,
  checked,
}: {
  readonly application: ApplicationView;
  readonly selecting: boolean;
  readonly checked: boolean;
}) {
  const due = mobileDueDate(application);
  const next = mobileNextStep(application);
  return (
    <>
      <span className="career-responses-mobile-row-heading">
        {selecting ? (
          <span className="career-responses-mobile-row-check" aria-hidden="true">
            {checked ? <CheckCircle weight="fill" /> : <Circle />}
          </span>
        ) : null}
        <strong>{companyName(application)}</strong>
        {due ? (
          <time className="career-numeric" dateTime={due.dateTime}>
            {due.label}
          </time>
        ) : null}
      </span>
      <span className="career-responses-mobile-row-role">
        {application.vacancy?.title ?? 'Вакансия без названия'} ·{' '}
        {humanSourceLabel(application.vacancy?.source)}
      </span>
      <span className="career-responses-mobile-row-footer">
        <span className="career-responses-mobile-row-status">
          {mobileStatusIcon(application)}
          <span>{mobileStatusLabel(application)}</span>
        </span>
        <span className={'career-responses-mobile-row-next' + (next.hot ? ' is-hot' : '')}>
          {next.label}
        </span>
      </span>
    </>
  );
}

function mobileStatusIcon(application: ApplicationView): ReactNode {
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
