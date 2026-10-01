import type { FormEvent } from 'react';

export interface VacancyInterviewFormProps {
  readonly scheduledLocal: string;
  readonly savingSchedule: boolean;
  readonly scheduleError?: string;
  readonly onChangeDate: (val: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: (e: FormEvent) => void;
}

export function VacancyInterviewForm({
  scheduledLocal,
  savingSchedule,
  scheduleError,
  onChangeDate,
  onClose,
  onSubmit,
}: VacancyInterviewFormProps) {
  return (
    <form
      className="vacancies-interview-assignment"
      aria-label="Назначить интервью"
      onSubmit={onSubmit}
    >
      <label>
        Дата и время интервью
        <input
          type="datetime-local"
          required
          value={scheduledLocal}
          onChange={(e) => onChangeDate(e.target.value)}
        />
      </label>
      {scheduleError ? (
        <p className="vacancies-interview-error" role="alert">
          {scheduleError}
        </p>
      ) : null}
      <div className="action-row">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Отмена
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!scheduledLocal || savingSchedule}
        >
          {savingSchedule ? 'Сохраняем…' : 'Сохранить и открыть подготовку'}
        </button>
      </div>
    </form>
  );
}
