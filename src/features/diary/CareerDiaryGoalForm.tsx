import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { X, Trash } from '@phosphor-icons/react';
import type { CareerDiaryGoalInput, CareerDiaryGoalPatch, CareerDiaryGoalSummary } from '../../../shared/careerDiary';
import { apiErrorMessage } from '../coach/apiClient';
import { CareerDiaryGoalFormFields } from './CareerDiaryGoalFormFields';
import {
  careerDiaryGoalInputFromDraft,
  careerDiaryGoalPatchFromDraft,
  createCareerDiaryGoalDraft,
  validateCareerDiaryGoalDraft,
  type CareerDiaryGoalFieldErrors,
  type CareerDiaryGoalDraft,
} from './careerDiaryGoalDraft';

interface CareerDiaryGoalFormProps {
  readonly goal?: CareerDiaryGoalSummary;
  readonly onClose: () => void;
  readonly onSave: (input: CareerDiaryGoalInput | CareerDiaryGoalPatch) => Promise<void>;
  readonly onDelete?: () => Promise<void>;
}

export function CareerDiaryGoalForm(props: CareerDiaryGoalFormProps) {
  const form = useCareerDiaryGoalFormState(props);
  useDialogFocus(form.dialogRef);
  return <CareerDiaryGoalFormDialog {...form} onClose={props.onClose} />;
  }

interface CareerDiaryGoalFormState {
  readonly dialogRef: RefObject<HTMLDialogElement>;
  readonly draft: CareerDiaryGoalDraft;
  readonly setDraft: (draft: CareerDiaryGoalDraft) => void;
  readonly errors: CareerDiaryGoalFieldErrors;
  readonly requestError: string | null;
  readonly saving: boolean;
  readonly title: string;
  readonly editing: boolean;
  readonly submit: (event: FormEvent<HTMLFormElement>) => void;
  readonly deleteGoal: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void;
}

function useCareerDiaryGoalFormState(props: CareerDiaryGoalFormProps): CareerDiaryGoalFormState {
  const { goal, onClose, onSave, onDelete } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => createCareerDiaryGoalDraft(goal));
  const [errors, setErrors] = useState<CareerDiaryGoalFieldErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const title = goal ? 'Изменить цель' : 'Новая цель';
  const submit = useCallback((event: FormEvent<HTMLFormElement>) => {
    void submitGoalDraft(event, draft, goal, onSave, onClose, setErrors, setSaving, setRequestError);
  }, [draft, goal, onClose, onSave]);
  const deleteGoal = useCallback(() => {
    void deleteCareerGoal(goal, onDelete, onClose, setSaving, setRequestError);
  }, [goal, onDelete, onClose]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDialogElement>) => {
    handleDialogKeyDown(event, dialogRef.current, onClose);
  }, [onClose]);
  return { dialogRef, draft, setDraft, errors, requestError, saving, title, editing: Boolean(goal), submit, deleteGoal, onKeyDown };
  }

async function submitGoalDraft(
  event: FormEvent<HTMLFormElement>,
  draft: CareerDiaryGoalDraft,
  goal: CareerDiaryGoalFormProps['goal'],
  onSave: CareerDiaryGoalFormProps['onSave'],
  onClose: CareerDiaryGoalFormProps['onClose'],
  setErrors: (errors: CareerDiaryGoalFieldErrors) => void,
  setSaving: (saving: boolean) => void,
  setRequestError: (error: string | null) => void,
) {
  event.preventDefault();
  const errors = validateCareerDiaryGoalDraft(draft);
  setErrors(errors);
  if (Object.keys(errors).length > 0) return;
  setSaving(true);
  setRequestError(null);
  try {
    await onSave(goal ? careerDiaryGoalPatchFromDraft(draft) : careerDiaryGoalInputFromDraft(draft));
    onClose();
  } catch (reason) {
    setRequestError(apiErrorMessage(reason, 'Цель не сохранена. Проверьте связь и повторите попытку.'));
  } finally {
    setSaving(false);
  }
}

async function deleteCareerGoal(
  goal: CareerDiaryGoalFormProps['goal'],
  onDelete: CareerDiaryGoalFormProps['onDelete'],
  onClose: CareerDiaryGoalFormProps['onClose'],
  setSaving: (saving: boolean) => void,
  setRequestError: (error: string | null) => void,
) {
  if (!goal || !onDelete || !window.confirm(`Удалить цель «${goal.title}» и её замеры?`)) return;
  setSaving(true);
  setRequestError(null);
  try {
    await onDelete();
    onClose();
    window.requestAnimationFrame(() => document.getElementById('career-diary-heading')?.focus());
  } catch (reason) {
    setRequestError(apiErrorMessage(reason, 'Цель не удалена. Повторите попытку.'));
  } finally {
    setSaving(false);
  }
}

function handleDialogKeyDown(
  event: KeyboardEvent<HTMLDialogElement>,
  dialog: HTMLDialogElement | null,
  onClose: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
  } else if (event.key === 'Tab') {
    trapDialogFocus(event, dialog);
  }
}

function CareerDiaryGoalFormDialog({
  dialogRef, draft, setDraft, errors, requestError, saving, title, submit, deleteGoal,
  onKeyDown, onClose, editing,
}: CareerDiaryGoalFormState & { readonly onClose: () => void }) {
  return (
    <dialog ref={dialogRef} open className="career-modal-backdrop career-diary-dialog-backdrop" aria-modal="true" aria-labelledby="career-diary-goal-form-title" onKeyDown={onKeyDown} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="career-modal-card is-detail career-diary-dialog">
        <header className="career-modal-header career-diary-dialog__header">
          <h2 id="career-diary-goal-form-title">{title}</h2>
          <button className="career-btn is-ghost is-icon" type="button" aria-label="Закрыть форму цели" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="career-modal-body career-diary-dialog__body">
            <p className="career-diary-note">Целевые и исходные значения задаёте вы. Платформа не измеряет их в компании.</p>
            <CareerDiaryGoalFormFields draft={draft} errors={errors} onChange={setDraft} />
            {requestError ? <p className="career-diary-error" role="alert">{requestError}</p> : null}
          </div>
          <GoalFormFooter editing={editing} saving={saving} onClose={onClose} onDelete={editing ? deleteGoal : undefined} />
        </form>
      </div>
    </dialog>
  );
}

function useDialogFocus(dialogRef: RefObject<HTMLDialogElement>) {
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const firstField = dialogRef.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)');
    firstField?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
      else window.requestAnimationFrame(() => document.getElementById('career-diary-heading')?.focus());
    };
  }, [dialogRef]);
}

function GoalFormFooter({
  editing,
  saving,
  onClose,
  onDelete,
}: {
  readonly editing: boolean;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onDelete?: () => void;
}) {
  return (
    <footer className="career-modal-footer career-diary-dialog__footer">
      {editing && onDelete ? <button className="career-btn is-danger" type="button" disabled={saving} onClick={onDelete}><Trash size={18} aria-hidden="true" />Удалить цель</button> : null}
      <button className="career-btn is-ghost" type="button" disabled={saving} onClick={onClose}>Отмена</button>
      <button className="career-btn is-primary" type="submit" disabled={saving} aria-busy={saving}>
        {saving ? 'Сохраняем…' : 'Сохранить цель'}
      </button>
    </footer>
  );
}


function trapDialogFocus(event: KeyboardEvent<HTMLDialogElement>, dialog: HTMLDialogElement | null) {
  const elements = Array.from(dialog?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  ) ?? []);
  if (elements.length === 0) return;
  const first = elements[0]!;
  const last = elements[elements.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
