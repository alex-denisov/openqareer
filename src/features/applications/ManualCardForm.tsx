import { useState } from 'react';
import { NotePencil } from '@phosphor-icons/react';
import { ImportModalShell } from '../connections/ImportModalShell';
import type { CreateApplicationInput } from './applicationsApi';

interface ManualCardFormProps {
  readonly onCancel: () => void;
  readonly onSubmit: (input: CreateApplicationInput) => Promise<void>;
}

/**
 * Ручная карточка «через рекрутера, компания скрыта» (architecture.md §4,
 * owner decision 2026-09-23: в v1). Нет вакансии в пуле — только то, что
 * кандидат сам знает про процесс.
 */
export function ManualCardForm({ onCancel, onSubmit }: ManualCardFormProps) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [companyHidden, setCompanyHidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (!title.trim()) {
      setError('Укажите название роли.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit({
        manualVacancy: {
          title: title.trim(),
          company: company.trim(),
          companyHidden,
          source: 'recruiter',
        },
        stage: 'saved',
      });
    } catch {
      setError('Не удалось сохранить карточку. Повторите.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // A real dialog (B331): the bare div had no styles, no backdrop and no
    // Escape, and opened below the fold of the board in the .app.
    <ImportModalShell
      isOpen
      onClose={onCancel}
      titleId="manual-card-title"
      title="Добавить карточку вручную"
      icon={<NotePencil size={18} aria-hidden="true" />}
    >
      <div className="career-modal-body career-responses-manual-form">
        <ManualCardFields
          title={title}
          onTitleChange={setTitle}
          company={company}
          onCompanyChange={setCompany}
          companyHidden={companyHidden}
          onCompanyHiddenChange={setCompanyHidden}
        />
        {error ? (
          <p className="career-modal-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="career-modal-footer is-compact">
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="career-primary-button"
          onClick={() => void submit()}
          disabled={submitting}
        >
          {submitting ? 'Сохраняем…' : 'Добавить'}
        </button>
      </div>
    </ImportModalShell>
  );
}

interface ManualCardFieldsProps {
  readonly title: string;
  readonly onTitleChange: (value: string) => void;
  readonly company: string;
  readonly onCompanyChange: (value: string) => void;
  readonly companyHidden: boolean;
  readonly onCompanyHiddenChange: (value: boolean) => void;
}

function ManualCardFields({
  title,
  onTitleChange,
  company,
  onCompanyChange,
  companyHidden,
  onCompanyHiddenChange,
}: ManualCardFieldsProps) {
  return (
    <>
      <label>
        Роль
        <input value={title} onChange={(event) => onTitleChange(event.target.value)} />
      </label>
      <label>
        Компания
        <input
          value={company}
          onChange={(event) => onCompanyChange(event.target.value)}
          disabled={companyHidden}
        />
      </label>
      <label className="career-responses-manual-check">
        <input
          type="checkbox"
          checked={companyHidden}
          onChange={(event) => onCompanyHiddenChange(event.target.checked)}
        />
        Компания скрыта рекрутером
      </label>
    </>
  );
}
