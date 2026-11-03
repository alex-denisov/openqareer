import { useState } from 'react';
import { ArrowsClockwise, CheckCircle, Download, FileText, X } from '@phosphor-icons/react';
import { triggerFileDownload } from '../resume/resumeExport';
import type { ApplicationListQuery, ApplicationView } from './applicationsApi';
import { applicationsCsv, sharedStatus } from './applicationSelectionModel';
import { BulkLabelPicker } from './BulkLabelPicker';
import { StatusIcon } from './ResponsesCard';
import {
  useApplicationBulkRunner,
  type ApplicationBulkRunner,
  type ApplicationBulkTarget,
} from './useApplicationBulkRunner';

export interface ResponsesSelectionBarProps {
  /** The picked rows, or every row of the filter after «Выбрать все по фильтру». */
  readonly selected: readonly ApplicationView[];
  readonly total: number;
  readonly allSelectedByFilter: boolean;
  readonly allowSelectAllFiltered: boolean;
  readonly query: ApplicationListQuery;
  readonly onSelectAllFiltered: () => void;
  readonly onClearSelection: () => void;
  /** A confirmed change: the workspace clears the selection and reloads. */
  readonly onComplete: (notice: string) => void;
  /** A message that changes nothing, e.g. after «Экспорт»; the selection stays. */
  readonly onNotice: (notice: string) => void;
  readonly onOpenResume?: () => void;
}

const BTN = 'career-btn career-btn-secondary career-btn-sm';

export function ResponsesSelectionBar(props: ResponsesSelectionBarProps) {
  const target: ApplicationBulkTarget = props.allSelectedByFilter
    ? { query: props.query }
    : { query: props.query, ids: props.selected.map((application) => application.id) };
  const runner = useApplicationBulkRunner(target, props.onComplete);
  const status = sharedStatus(props.selected);
  return (
    <>
      <SelectionSummary {...props} status={status} />
      <div
        className="career-responses-bulk-actions"
        role="group"
        aria-label="Действия с выбранными"
      >
        {status?.tone === 'fail' ? (
          <FailedStatusActions runner={runner} onOpenResume={props.onOpenResume} />
        ) : null}
        <span className="career-responses-bulk-group">Для любых статусов</span>
        <button
          type="button"
          className={BTN}
          disabled={runner.busy}
          onClick={() => runner.preview({ action: { type: 'close' } })}
        >
          <X aria-hidden="true" />
          Закрыть отклики
        </button>
        <BulkLabelPicker
          disabled={runner.busy}
          onPick={(label) =>
            runner.preview({ action: { type: 'label', labelId: label.id }, labelName: label.name })
          }
        />
        <ExportButton selected={props.selected} onNotice={props.onNotice} />
      </div>
      <BulkConfirm runner={runner} />
      <p className="career-responses-bulk-hint">
        Действия по статусу показываются, когда у всех выбранных откликов один статус. При смешанном
        выборе остаются общие: закрыть, метка, экспорт.
      </p>
    </>
  );
}

function SelectionSummary(
  props: ResponsesSelectionBarProps & { readonly status: ReturnType<typeof sharedStatus> },
) {
  const count = props.allSelectedByFilter ? props.total : props.selected.length;
  return (
    <div className="career-responses-selection" role="status">
      <CheckCircle aria-hidden="true" />
      <span>
        Выбрано <span className="career-numeric">{count}</span> из{' '}
        <span className="career-numeric">{props.total}</span>
        {props.status ? (
          <>
            , все со статусом{' '}
            <span className={'career-responses-status-pill is-' + props.status.tone}>
              <StatusIcon tone={props.status.tone} />
              {props.status.label}
            </span>
          </>
        ) : null}
      </span>
      {props.allSelectedByFilter ? (
        <button type="button" className="career-responses-link" onClick={props.onClearSelection}>
          Снять выбор
        </button>
      ) : props.allowSelectAllFiltered && props.total > props.selected.length ? (
        <button type="button" className="career-responses-link" onClick={props.onSelectAllFiltered}>
          Выбрать все {props.total} по фильтру
        </button>
      ) : null}
    </div>
  );
}

function FailedStatusActions({
  runner,
  onOpenResume,
}: {
  readonly runner: ApplicationBulkRunner;
  readonly onOpenResume?: () => void;
}) {
  return (
    <>
      <span className="career-responses-bulk-group">Для этого статуса</span>
      <button
        type="button"
        className={BTN}
        disabled={runner.busy}
        onClick={() => runner.preview({ action: { type: 'retry' } })}
      >
        <ArrowsClockwise aria-hidden="true" />
        Повторить отклик
      </button>
      {onOpenResume ? (
        <button
          type="button"
          className={BTN}
          disabled={runner.busy}
          onClick={() => runner.preview({ action: { type: 'retry' }, after: onOpenResume })}
        >
          <FileText aria-hidden="true" />
          Исправить резюме и повторить
        </button>
      ) : null}
      <span className="career-responses-bulk-sep" aria-hidden="true" />
    </>
  );
}

function ExportButton({
  selected,
  onNotice,
}: {
  readonly selected: readonly ApplicationView[];
  readonly onNotice: (notice: string) => void;
}) {
  const [error, setError] = useState('');
  const exportRows = async () => {
    setError('');
    try {
      await triggerFileDownload('otkliki.csv', applicationsCsv(selected), 'text/csv;charset=utf-8');
      onNotice('Выгружено откликов: ' + selected.length + '.');
    } catch {
      setError('Не удалось сохранить файл. Повторите экспорт.');
    }
  };
  return (
    <>
      <button type="button" className={BTN} onClick={() => void exportRows()}>
        <Download aria-hidden="true" />
        Экспорт
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </>
  );
}

function BulkConfirm({ runner }: { readonly runner: ApplicationBulkRunner }) {
  if (!runner.pending && !runner.error) return null;
  return (
    <div className="career-responses-bulk-confirm">
      {runner.pending ? (
        <>
          <button
            type="button"
            className="career-btn career-btn-primary career-btn-sm"
            disabled={runner.busy}
            onClick={runner.confirm}
          >
            Подтвердить: {runner.pending.count}
          </button>
          <button type="button" className={BTN} disabled={runner.busy} onClick={runner.cancel}>
            Отмена
          </button>
        </>
      ) : null}
      {runner.error ? <span role="alert">{runner.error}</span> : null}
    </div>
  );
}

/** Mobile «Действия» after «Все»: retry and close for the whole filter. */
export function ApplicationBulkActions({
  query,
  onComplete,
}: {
  readonly query: ApplicationListQuery;
  readonly onComplete: (notice: string) => void;
}) {
  const runner = useApplicationBulkRunner({ query }, onComplete);
  return (
    <div className="career-responses-bulk-actions" role="group" aria-label="Массовое действие">
      <button
        type="button"
        className={BTN}
        disabled={runner.busy}
        onClick={() => runner.preview({ action: { type: 'retry' } })}
      >
        Повторить отклик
      </button>
      <button
        type="button"
        className={BTN}
        disabled={runner.busy}
        onClick={() => runner.preview({ action: { type: 'close' } })}
      >
        Закрыть отклики
      </button>
      <BulkConfirm runner={runner} />
    </div>
  );
}
