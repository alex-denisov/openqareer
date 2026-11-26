import { useEffect, useRef, useState, type RefObject } from 'react';
import { OWN_VACANCY_MAX } from '../../../../../shared/b640OwnVacancy';
import { Icon } from '../../kit';
import type { OwnAddStatus } from './useOwnVacancies';

/** «Проверить свою вакансию» в строке счётчика; на 390 подпись короче (макет v06q). */
export function OwnAddButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="btn va-addbtn" type="button" aria-expanded={open} aria-controls={open ? 'va-add' : undefined} onClick={onClick}>
      <Icon name="plus" />
      <span className="vl-lg">Проверить свою вакансию</span>
      <span className="vl-sm">Своя вакансия</span>
    </button>
  );
}

const UNREADABLE: Readonly<Record<string, string>> = {
  failed: 'Страница не открылась',
  site_closed: 'Этот сайт не разрешает читать страницу',
  thin: 'На странице нет текста вакансии',
};

function statusText(status: OwnAddStatus): string | null {
  if (status.kind === 'unreadable') return UNREADABLE[status.reason] ?? UNREADABLE.failed!;
  if (status.kind === 'limit') return `Своих вакансий уже ${OWN_VACANCY_MAX} — это предел`;
  return status.kind === 'error' ? status.text : null;
}

interface StatusProps {
  readonly status: OwnAddStatus;
  readonly onRetry: () => void;
  readonly onPasteText: () => void;
}

function AddStatus({ status, onRetry, onPasteText }: StatusProps) {
  if (status.kind === 'reading') {
    return (
      <p className="va-add-st" id="va-add-st" role="status" aria-busy="true">
        <Icon name="hourglass" />
        Читаем вакансию…
      </p>
    );
  }
  const text = statusText(status);
  if (!text) return null;
  const retry = status.kind === 'error' || (status.kind === 'unreadable' && status.reason === 'failed');
  const paste = status.kind === 'unreadable';
  return (
    <div className="va-add-st is-err" id="va-add-st" role="alert">
      <span><Icon name="warn" />{text}</span>
      {/* Макет v06q: «Повторить» — кнопка с иконкой repeat, «Вставить текст» — действие строки с edit. */}
      {retry ? <button className="btn is-sm" type="button" onClick={onRetry}><Icon name="repeat" />Повторить</button> : null}
      {paste ? <button className="row-act" type="button" onClick={onPasteText}><Icon name="edit" />Вставить текст</button> : null}
    </div>
  );
}

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

interface AddFieldProps {
  readonly field: RefObject<HTMLTextAreaElement>;
  readonly value: string;
  readonly failed: boolean;
  readonly described: boolean;
  readonly onChange: (value: string) => void;
}

function AddField({ field, value, failed, described, onChange }: AddFieldProps) {
  return (
    <label className="va-add-f" htmlFor="va-add-in">
      <span>Ссылка или текст вакансии</span>
      <textarea
        id="va-add-in"
        ref={field}
        rows={2}
        value={value}
        aria-invalid={failed ? true : undefined}
        aria-describedby={described ? 'va-add-st' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export interface OwnVacancyPanelProps {
  readonly status: OwnAddStatus;
  readonly onAdd: (value: string) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onEdit: () => void;
}

/** Панель над таблицей (на 390 — лист): ссылка или текст, чтение прямо в блоке, «Добавить». */
export function OwnVacancyPanel({ status, onAdd, onClose, onEdit }: OwnVacancyPanelProps) {
  const [value, setValue] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  useEscape(onClose);
  const reading = status.kind === 'reading';
  const failed = status.kind !== 'idle' && !reading;
  const submit = async () => {
    if (!value.trim() || reading) return;
    if (await onAdd(value)) onClose();
  };
  const pasteText = () => {
    setValue('');
    onEdit();
    field.current?.focus();
  };
  return (
    <>
      <div className="va-add-back" aria-hidden="true" onClick={onClose} />
      <section className={`va-add is-panel${failed ? ' is-err' : ''}`} id="va-add" aria-labelledby="va-add-t">
        <span className="grab" aria-hidden="true" />
        <div className="va-add-h">
          <h3 className="va-add-t" id="va-add-t">Своя вакансия</h3>
          <button className="icon-btn" type="button" aria-label="Закрыть: своя вакансия" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <AddField field={field} value={value} failed={failed} described={status.kind !== 'idle'} onChange={(next) => { setValue(next); if (failed) onEdit(); }} />
        <AddStatus status={status} onRetry={() => void submit()} onPasteText={pasteText} />
        <div className="va-add-foot">
          <button className="btn is-primary" type="button" aria-disabled={reading || !value.trim() ? true : undefined} onClick={() => void submit()}>
            <Icon name="plus" />
            Добавить
          </button>
        </div>
      </section>
    </>
  );
}
