import { useState, type FormEvent } from 'react';
import type { CareerDiaryGoalSummary, CareerDiaryMeasurementInput, CareerDiaryValue } from '../../../shared/careerDiary';

interface CareerDiaryMeasurementFormProps {
  readonly goal: CareerDiaryGoalSummary;
  readonly saving: boolean;
  readonly onSave: (input: CareerDiaryMeasurementInput) => Promise<void>;
}

export function CareerDiaryMeasurementForm({ goal, saving, onSave }: CareerDiaryMeasurementFormProps) {
  const [value, setValue] = useState('');
  const [measuredAt, setMeasuredAt] = useState(todayLocalDate());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedValue = parseValue(value, goal.targetValue);
    if (parsedValue === null) {
      setError(value.trim() ? 'Введите значение в формате цели.' : 'Укажите значение замера.');
      return;
    }
    if (!measuredAt) {
      setError('Укажите дату замера.');
      return;
    }
    setError(null);
    try {
      await onSave({ value: parsedValue, measuredAt, note: note.trim() || null });
      setValue('');
      setNote('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить замер. Повторите попытку.');
    }
  }

  return (
    <section className="career-diary-measurement" aria-labelledby="career-diary-measurement-title">
      <h3 id="career-diary-measurement-title">Записать значение</h3>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <MeasurementValueField goal={goal} value={value} onChange={setValue} error={error} />
        <label className="career-field" htmlFor="career-diary-measured-at">
          <span className="career-field-label">Дата замера</span>
          <input id="career-diary-measured-at" className="career-input" type="date" value={measuredAt} onChange={(event) => setMeasuredAt(event.currentTarget.value)} />
        </label>
        <label className="career-field" htmlFor="career-diary-measurement-note">
          <span className="career-field-label">Комментарий</span>
          <textarea id="career-diary-measurement-note" className="career-input" value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={2000} />
        </label>
        {error ? <p className="career-diary-error" id="career-diary-measurement-error" role="alert">{error}</p> : null}
        <p className="career-diary-field-note">Источник замера: ввели вы.</p>
        <button className="career-btn is-primary" type="submit" disabled={saving} aria-busy={saving}>
          {saving ? 'Сохраняем…' : 'Записать значение'}
        </button>
      </form>
    </section>
  );
}

function MeasurementValueField({
  goal,
  value,
  onChange,
  error,
}: {
  readonly goal: CareerDiaryGoalSummary;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
}) {
  const label = `Значение, ${goal.unit}`;
  if (typeof goal.targetValue === 'boolean') {
    return (
      <label className="career-field" htmlFor="career-diary-measurement-value">
        <span className="career-field-label">{label}</span>
        <select id="career-diary-measurement-value" className="career-select" value={value} onChange={(event) => onChange(event.currentTarget.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'career-diary-measurement-error' : undefined}>
          <option value="">Выберите значение</option><option value="true">Да</option><option value="false">Нет</option>
        </select>
      </label>
    );
  }
  return (
    <label className="career-field" htmlFor="career-diary-measurement-value">
      <span className="career-field-label">{label}</span>
      <input
        id="career-diary-measurement-value"
        className="career-input"
        type={typeof goal.targetValue === 'number' ? 'number' : 'text'}
        step={typeof goal.targetValue === 'number' ? 'any' : undefined}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'career-diary-measurement-error' : undefined}
      />
    </label>
  );
}

function parseValue(input: string, targetValue: CareerDiaryValue): CareerDiaryValue | null {
  if (!input.trim()) return null;
  if (typeof targetValue === 'boolean') return input === 'true' ? true : input === 'false' ? false : null;
  if (typeof targetValue !== 'number') return input.trim();
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
