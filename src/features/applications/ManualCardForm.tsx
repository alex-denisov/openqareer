import { useState } from 'react';
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
        manualVacancy: { title: title.trim(), company: company.trim(), companyHidden, source: 'recruiter' },
        stage: 'saved',
      });
    } catch {
      setError('Не удалось сохранить карточку. Повторите.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="career-responses-manual-form" role="dialog" aria-label="Добавить карточку вручную">
      <label>
        Роль
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Компания
        <input
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          disabled={companyHidden}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={companyHidden}
          onChange={(event) => setCompanyHidden(event.target.checked)}
        />
        Компания скрыта рекрутером
      </label>
      {error ? (
        <p className="career-responses-card-failed" role="alert">
          {error}
        </p>
      ) : null}
      <div className="career-responses-manual-form-actions">
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button type="button" onClick={() => void submit()} disabled={submitting}>
          Добавить
        </button>
      </div>
    </div>
  );
}
