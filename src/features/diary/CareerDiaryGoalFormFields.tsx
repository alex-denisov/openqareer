import type { ReactNode } from 'react';
import type { CareerDiaryGoalFieldErrors, CareerDiaryGoalDraft } from './careerDiaryGoalDraft';

interface CareerDiaryGoalFormFieldsProps {
  readonly draft: CareerDiaryGoalDraft;
  readonly errors: CareerDiaryGoalFieldErrors;
  readonly onChange: (draft: CareerDiaryGoalDraft) => void;
}

export function CareerDiaryGoalFormFields({ draft, errors, onChange }: CareerDiaryGoalFormFieldsProps) {
  return (
    <div className="career-diary-form-fields">
      <FormField id="career-diary-goal-title" label="Цель" error={errors.title}>
        <input className="career-input" id="career-diary-goal-title" value={draft.title} maxLength={240} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'career-diary-goal-title-error' : undefined} onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })} />
      </FormField>
      <FormField id="career-diary-goal-type" label="Тип">
        <select className="career-select" id="career-diary-goal-type" value={draft.type} onChange={(event) => onChange({ ...draft, type: event.currentTarget.value as CareerDiaryGoalDraft['type'] })}>
          <option value="operational">Операционная</option><option value="team">Командная</option>
          <option value="strategic">Стратегическая</option><option value="development">Развитие</option>
        </select>
      </FormField>
      <FormField id="career-diary-goal-horizon" label="Горизонт">
        <select className="career-select" id="career-diary-goal-horizon" value={draft.horizon} onChange={(event) => onChange({ ...draft, horizon: event.currentTarget.value as CareerDiaryGoalDraft['horizon'] })}>
          <option value="quarter">Этот квартал</option><option value="next_quarter">Следующий квартал</option><option value="year">Год</option>
        </select>
      </FormField>
      <FormField id="career-diary-goal-start" label="Начало" error={errors.startDate}>
        <input className="career-input" id="career-diary-goal-start" type="date" value={draft.startDate} aria-invalid={Boolean(errors.startDate)} aria-describedby={errors.startDate ? 'career-diary-goal-start-error' : undefined} onChange={(event) => onChange({ ...draft, startDate: event.currentTarget.value })} />
      </FormField>
      <FormField id="career-diary-goal-due" label="Срок" error={errors.dueDate}>
        <input className="career-input" id="career-diary-goal-due" type="date" value={draft.dueDate} aria-invalid={Boolean(errors.dueDate)} aria-describedby={errors.dueDate ? 'career-diary-goal-due-error' : undefined} onChange={(event) => onChange({ ...draft, dueDate: event.currentTarget.value })} />
      </FormField>
      <FormField id="career-diary-goal-unit" label="Единица" error={errors.unit}>
        <input className="career-input" id="career-diary-goal-unit" value={draft.unit} maxLength={80} aria-invalid={Boolean(errors.unit)} aria-describedby={errors.unit ? 'career-diary-goal-unit-error' : undefined} onChange={(event) => onChange({ ...draft, unit: event.currentTarget.value })} />
      </FormField>
      <FormField id="career-diary-target-kind" label="Формат цели">
        <select className="career-select" id="career-diary-target-kind" value={draft.targetKind} onChange={(event) => onChange({ ...draft, targetKind: event.currentTarget.value as CareerDiaryGoalDraft['targetKind'], targetValue: '', baselineValue: '' })}>
          <option value="number">Число</option><option value="text">Текст</option><option value="boolean">Да или нет</option>
        </select>
      </FormField>
      <TargetValueField draft={draft} error={errors.targetValue} onChange={onChange} />
      <FormField id="career-diary-baseline" label="Исходное значение" error={errors.baselineValue}>
        <input className="career-input" id="career-diary-baseline" type="number" step="any" value={draft.baselineValue} disabled={draft.targetKind !== 'number'} aria-invalid={Boolean(errors.baselineValue)} aria-describedby={errors.baselineValue ? 'career-diary-baseline-error' : undefined} onChange={(event) => onChange({ ...draft, baselineValue: event.currentTarget.value })} />
      </FormField>
      <ReadOnlyMeasurementSettings />
    </div>
  );
}

function TargetValueField({
  draft,
  error,
  onChange,
}: {
  readonly draft: CareerDiaryGoalDraft;
  readonly error?: string;
  readonly onChange: (draft: CareerDiaryGoalDraft) => void;
}) {
  if (draft.targetKind === 'boolean') {
    return (
      <FormField id="career-diary-target" label="Целевое значение" error={error}>
        <select className="career-select" id="career-diary-target" value={draft.targetValue} aria-invalid={Boolean(error)} aria-describedby={error ? 'career-diary-target-error' : undefined} onChange={(event) => onChange({ ...draft, targetValue: event.currentTarget.value })}>
          <option value="">Выберите значение</option><option value="true">Да</option><option value="false">Нет</option>
        </select>
      </FormField>
    );
  }
  return (
    <FormField id="career-diary-target" label="Целевое значение" error={error}>
      <input className="career-input" id="career-diary-target" type={draft.targetKind === 'number' ? 'number' : 'text'} step={draft.targetKind === 'number' ? 'any' : undefined} value={draft.targetValue} maxLength={500} aria-invalid={Boolean(error)} aria-describedby={error ? 'career-diary-target-error' : undefined} onChange={(event) => onChange({ ...draft, targetValue: event.currentTarget.value })} />
    </FormField>
  );
}

function FormField({
  id,
  label,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly error?: string;
  readonly children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="career-field">
      <label className="career-field-label" htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="career-diary-field-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

function ReadOnlyMeasurementSettings() {
  return (
    <div className="career-diary-form-source" aria-label="Источник и обновление значений">
      <p><span>Источник значения</span><output>Ввели вы</output></p>
      <p><span>Обновление</span><output>По мере внесения замеров</output></p>
      <p>Расписание обновлений в дневнике не настраивается.</p>
    </div>
  );
}
