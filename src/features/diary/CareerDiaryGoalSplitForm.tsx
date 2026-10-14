import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { X } from '@phosphor-icons/react';
import type { CareerDiaryGoal, CareerDiaryGoalInput } from '../../../shared/careerDiary';
import { apiErrorMessage } from '../coach/apiClient';

interface CareerDiaryGoalSplitFormProps {
  readonly goal: CareerDiaryGoal;
  readonly onClose: () => void;
  readonly onSave: (children: readonly CareerDiaryGoalInput[]) => Promise<CareerDiaryGoal[]>;
  readonly onSaved: (children: CareerDiaryGoal[]) => void;
}

interface ChildGoalDraft {
  readonly title: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly targetValue: string;
}

type GoalTargetType = 'number' | 'text' | 'boolean';

export function CareerDiaryGoalSplitForm(props: CareerDiaryGoalSplitFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [children, setChildren] = useState(() => initialChildDrafts(props.goal));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSplitDialogFocus(dialogRef, props.onClose);

  function updateChild(index: number, patch: Partial<ChildGoalDraft>) {
    setChildren((current) =>
      current.map((child, position) => (position === index ? { ...child, ...patch } : child)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    void saveSplit(event, props, children, setSaving, setError);
  }

  return (
    <dialog
      ref={dialogRef}
      open
      className="career-modal-backdrop career-diary-dialog-backdrop"
      aria-modal="true"
      aria-labelledby="career-diary-split-title"
      onKeyDown={(event) => handleSplitKeyDown(event, dialogRef.current, props.onClose)}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <SplitDialogContent
        goal={props.goal}
        children={children}
        saving={saving}
        error={error}
        onClose={props.onClose}
        onSubmit={submit}
        onChildChange={updateChild}
      />
    </dialog>
  );
}

function SplitDialogContent({
  goal,
  children,
  saving,
  error,
  onClose,
  onSubmit,
  onChildChange,
}: {
  readonly goal: CareerDiaryGoal;
  readonly children: readonly ChildGoalDraft[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onChildChange: (index: number, patch: Partial<ChildGoalDraft>) => void;
}) {
  return (
    <div className="career-modal-card is-detail career-diary-dialog">
      <SplitDialogHeader onClose={onClose} />
      <form onSubmit={onSubmit} noValidate>
        <SplitDialogBody
          goal={goal}
          children={children}
          saving={saving}
          error={error}
          onChildChange={onChildChange}
        />
        <SplitDialogFooter saving={saving} onClose={onClose} />
      </form>
    </div>
  );
}

function SplitDialogHeader({ onClose }: { readonly onClose: () => void }) {
  return (
    <header className="career-modal-header career-diary-dialog__header">
      <h2 id="career-diary-split-title">Разбить цель</h2>
      <button
        className="career-btn is-ghost is-icon"
        type="button"
        aria-label="Закрыть разбиение"
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </button>
    </header>
  );
}

function SplitDialogBody({
  goal,
  children,
  saving,
  error,
  onChildChange,
}: {
  readonly goal: CareerDiaryGoal;
  readonly children: readonly ChildGoalDraft[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onChildChange: (index: number, patch: Partial<ChildGoalDraft>) => void;
}) {
  return (
    <div className="career-modal-body career-diary-dialog__body">
      <p className="career-diary-note">
        Задайте две части. Тип, горизонт и единица сохраняются от исходной цели.
      </p>
      {children.map((child, index) => (
        <ChildGoalFields
          key={index}
          child={child}
          index={index}
          disabled={saving}
          targetType={targetType(goal.targetValue)}
          onChange={(patch) => onChildChange(index, patch)}
        />
      ))}
      {error ? (
        <p className="career-diary-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SplitDialogFooter({
  saving,
  onClose,
}: {
  readonly saving: boolean;
  readonly onClose: () => void;
}) {
  return (
    <footer className="career-modal-footer career-diary-dialog__footer">
      <button className="career-btn is-ghost" type="button" disabled={saving} onClick={onClose}>
        Отмена
      </button>
      <button className="career-btn is-primary" type="submit" disabled={saving} aria-busy={saving}>
        {saving ? 'Сохраняем…' : 'Сохранить разбиение'}
      </button>
    </footer>
  );
}

function ChildGoalFields({
  child,
  index,
  disabled,
  targetType,
  onChange,
}: {
  readonly child: ChildGoalDraft;
  readonly index: number;
  readonly disabled: boolean;
  readonly targetType: GoalTargetType;
  readonly onChange: (patch: Partial<ChildGoalDraft>) => void;
}) {
  const number = index + 1;
  return (
    <div className="career-diary-form-fields" role="group" aria-label={`Подцель ${number}`}>
      <SplitField
        id={`career-diary-split-title-${number}`}
        label={`Название подцели ${number}`}
        disabled={disabled}
        value={child.title}
        onChange={(title) => onChange({ title })}
      />
      <SplitField
        id={`career-diary-split-start-${number}`}
        label={`Дата начала подцели ${number}`}
        disabled={disabled}
        type="date"
        value={child.startDate}
        onChange={(startDate) => onChange({ startDate })}
      />
      <SplitField
        id={`career-diary-split-due-${number}`}
        label={`Срок подцели ${number}`}
        disabled={disabled}
        type="date"
        value={child.dueDate}
        onChange={(dueDate) => onChange({ dueDate })}
      />
      <SplitField
        id={`career-diary-split-target-${number}`}
        label={`Целевое значение подцели ${number}`}
        disabled={disabled}
        type={targetType}
        value={child.targetValue}
        onChange={(targetValue) => onChange({ targetValue })}
      />
    </div>
  );
}

function SplitField({
  id,
  label,
  value,
  type = 'text',
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly type?: 'text' | 'date' | 'number' | 'boolean';
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="career-field">
      <label className="career-field-label" htmlFor={id}>
        {label}
      </label>
      {type === 'boolean' ? (
        <select
          id={id}
          className="career-select"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Выберите значение</option>
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </select>
      ) : (
        <input
          id={id}
          className="career-input"
          type={type}
          step={type === 'number' ? 'any' : undefined}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </div>
  );
}

function initialChildDrafts(goal: CareerDiaryGoal): ChildGoalDraft[] {
  return [0, 1].map(() => ({
    title: '',
    startDate: goal.startDate,
    dueDate: goal.dueDate,
    targetValue: '',
  }));
}

async function saveSplit(
  event: FormEvent<HTMLFormElement>,
  props: CareerDiaryGoalSplitFormProps,
  drafts: readonly ChildGoalDraft[],
  setSaving: (value: boolean) => void,
  setError: (value: string | null) => void,
) {
  event.preventDefault();
  const valueType = targetType(props.goal.targetValue);
  const children = childGoalInputs(props.goal, drafts, valueType);
  const validationError = validateChildGoals(drafts, valueType);
  if (validationError) return setError(validationError);
  setSaving(true);
  setError(null);
  try {
    props.onSaved(await props.onSave(children));
    props.onClose();
  } catch (reason) {
    setError(apiErrorMessage(reason, 'Подцели не сохранены. Повторите попытку.'));
  } finally {
    setSaving(false);
  }
}

function childGoalInputs(
  goal: CareerDiaryGoal,
  drafts: readonly ChildGoalDraft[],
  valueType: GoalTargetType,
): CareerDiaryGoalInput[] {
  return drafts.map((draft, index) => ({
    title: draft.title.trim(),
    type: goal.type,
    horizon: goal.horizon,
    startDate: draft.startDate,
    dueDate: draft.dueDate,
    unit: goal.unit,
    baselineValue:
      index === 0 ? goal.baselineValue : numericValue(drafts[0]?.targetValue, valueType),
    targetValue: parseTargetValue(draft.targetValue, valueType),
  }));
}

function targetType(value: CareerDiaryGoal['targetValue']): GoalTargetType {
  if (typeof value === 'boolean') return 'boolean';
  return typeof value === 'number' ? 'number' : 'text';
}

function parseTargetValue(
  value: string,
  valueType: GoalTargetType,
): CareerDiaryGoal['targetValue'] {
  if (valueType === 'boolean') return value === 'true';
  if (valueType === 'number') return Number(value);
  return value.trim();
}

function numericValue(value: string | undefined, valueType: GoalTargetType): number | null {
  if (valueType !== 'number' || !value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateChildGoals(
  drafts: readonly ChildGoalDraft[],
  valueType: GoalTargetType,
): string | null {
  const valid = drafts.every(
    (draft) =>
      draft.title.trim() &&
      draft.targetValue.trim() &&
      draft.startDate &&
      draft.dueDate &&
      draft.dueDate >= draft.startDate &&
      validTarget(draft.targetValue, valueType),
  );
  return valid
    ? null
    : 'Заполните название, значение и даты для обеих подцелей. Срок не может быть раньше начала.';
}

function validTarget(value: string, valueType: GoalTargetType): boolean {
  if (valueType === 'boolean') return value === 'true' || value === 'false';
  if (valueType === 'text') return Boolean(value.trim());
  return value.trim() !== '' && Number.isFinite(Number(value));
}

function useSplitDialogFocus(dialogRef: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    return () => previousFocus?.focus();
  }, [dialogRef, onClose]);
}

function handleSplitKeyDown(
  event: KeyboardEvent<HTMLDialogElement>,
  dialog: HTMLDialogElement | null,
  onClose: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== 'Tab' || !dialog) return;
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
  ];
  trapSplitDialogFocus(event, controls);
}

function trapSplitDialogFocus(event: KeyboardEvent<HTMLDialogElement>, controls: HTMLElement[]) {
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
