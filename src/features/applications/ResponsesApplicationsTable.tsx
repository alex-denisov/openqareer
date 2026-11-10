import { useState } from 'react';
import { DotsThreeVertical } from '@phosphor-icons/react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type {
  ApplicationListPageMeta,
  ApplicationListQuery,
  ApplicationView,
} from './applicationsApi';
import { humanSourceLabel } from './sourceLabels';
import {
  formatDayMonth,
  responseNextStep as cardNextStep,
  responseStatusPill,
} from './responseCardFace';
import { StatusIcon } from './ResponsesCard';
import { ResponsesSelectionBar } from './ResponsesSelectionBar';

export interface ResponsesApplicationsTableProps {
  readonly applications: readonly ApplicationView[];
  /** Every row of the filter, not only the shown page: the bar resolves picked ids against it. */
  readonly filteredApplications: readonly ApplicationView[];
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
  /** «Исправить резюме и повторить» opens the resume after the retry is queued. */
  readonly onOpenResume?: () => void;
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
      <ApplicationSelectionBar
        {...props}
        onBulkComplete={handleBulkComplete}
        onNotice={setBulkNotice}
      />
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

function ApplicationSelectionBar(
  props: ResponsesApplicationsTableProps & {
    readonly onBulkComplete: (notice: string) => void;
    readonly onNotice: (notice: string) => void;
  },
) {
  if (!props.selectedIds.size && !props.allSelectedByFilter) return null;
  const selected = props.allSelectedByFilter
    ? props.filteredApplications
    : props.filteredApplications.filter((application) => props.selectedIds.has(application.id));
  return (
    <ResponsesSelectionBar
      selected={selected}
      total={props.pageMeta?.total ?? props.filteredApplications.length}
      allSelectedByFilter={props.allSelectedByFilter}
      allowSelectAllFiltered={props.allowSelectAllFiltered}
      query={props.query}
      onSelectAllFiltered={props.onSelectAllFiltered}
      onClearSelection={props.onClearSelection}
      onComplete={props.onBulkComplete}
      onNotice={props.onNotice}
      onOpenResume={props.onOpenResume}
    />
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
    <div className="career-responses-table-scroll">
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
    </div>
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
    <tr className={active || selected ? 'is-selected' : undefined}>
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
        {humanSourceLabel(vacancy?.source)} · {cardNextStep(application).text}
      </p>
      <small>{dueAt ? 'Срок: ' + formatDate(dueAt) : 'Срок шага не указан'}</small>
    </article>
  );
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
