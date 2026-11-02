import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { COMPANY_WANT_BULK_LIMIT } from './companyWantsApi';
import { exceedsBulkLimit, parseCompanyNames } from './companyWantsModel';

const MAX_FILE_BYTES = 512 * 1024;

function ModalDialog({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
    return () => dialog?.close?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="career-company-wants-dialog"
      aria-label={title}
      onCancel={onClose}
      onClose={onClose}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

function DialogActions({
  submitLabel,
  disabled,
  onClose,
}: {
  readonly submitLabel: string;
  readonly disabled: boolean;
  readonly onClose: () => void;
}) {
  return (
    <div className="career-company-wants-dialog-actions">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        onClick={onClose}
      >
        Отмена
      </button>
      <button
        type="submit"
        className="career-btn career-btn-primary career-btn-sm"
        disabled={disabled}
      >
        {submitLabel}
      </button>
    </div>
  );
}

function useCompanyNamesInput() {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState('');
  const names = parseCompanyNames(text);
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    setFileError('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError('Файл больше 512 КБ. Разделите список на части.');
      return;
    }
    const content = await file.text();
    setText((current) => [current.trim(), content.trim()].filter(Boolean).join('\n'));
  };
  return { text, setText, fileError, names, tooMany: exceedsBulkLimit(names.length), readFile };
}

function namesHint(count: number, tooMany: boolean): string {
  return tooMany
    ? `В списке ${count} компаний, за раз можно добавить до ${COMPANY_WANT_BULK_LIMIT}.`
    : `Компаний в списке: ${count}. До ${COMPANY_WANT_BULK_LIMIT} за раз.`;
}

export function AddCompaniesDialog({
  busy,
  onAdd,
  onClose,
}: {
  readonly busy: boolean;
  readonly onAdd: (names: readonly string[]) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const { text, setText, fileError, names, tooMany, readFile } = useCompanyNamesInput();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (names.length === 0 || tooMany) return;
    if (await onAdd(names)) onClose();
  };
  return (
    <ModalDialog title="Добавить компании" onClose={onClose}>
      <form className="career-company-wants-dialog-form" onSubmit={(event) => void submit(event)}>
        <label className="career-company-wants-label" htmlFor="company-wants-add-text">
          Названия компаний, по одной в строке
        </label>
        <textarea
          id="company-wants-add-text"
          className="career-company-wants-textarea"
          rows={8}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder={'Нордлайн Финтех\nСфера Платежи'}
        />
        <label className="career-company-wants-file">
          <span>Или загрузите файл .txt или .csv (первый столбец)</span>
          <input
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            onChange={(event) => void readFile(event)}
          />
        </label>
        <p className="career-company-wants-hint" role="status">
          {namesHint(names.length, tooMany)}
        </p>
        {fileError ? <p role="alert">{fileError}</p> : null}
        <DialogActions
          submitLabel="Добавить"
          disabled={busy || names.length === 0 || tooMany}
          onClose={onClose}
        />
      </form>
    </ModalDialog>
  );
}

export function NextStepDialog({
  count,
  initial,
  onSave,
  onClose,
}: {
  readonly count: number;
  readonly initial: string;
  readonly onSave: (text: string) => void;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onSave(text.trim());
    onClose();
  };
  return (
    <ModalDialog
      title={count > 1 ? `Следующий шаг для ${count} компаний` : 'Следующий шаг'}
      onClose={onClose}
    >
      <form className="career-company-wants-dialog-form" onSubmit={submit}>
        <label className="career-company-wants-label" htmlFor="company-wants-next-step">
          Что сделать дальше
        </label>
        <input
          id="company-wants-next-step"
          className="career-company-wants-input"
          value={text}
          maxLength={180}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <DialogActions submitLabel="Сохранить" disabled={!text.trim()} onClose={onClose} />
      </form>
    </ModalDialog>
  );
}
