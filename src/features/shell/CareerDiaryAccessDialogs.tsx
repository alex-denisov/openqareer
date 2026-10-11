import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { X } from '@phosphor-icons/react';
import type { CareerDiaryWorkplace, CareerDiaryWorkplaceInput } from '../../../shared/careerDiary';
import { useEscapeLayer } from './escapeLayers';
import type { CareerDiaryProfileExperience } from './careerDiaryAccess';

interface CareerDiaryProfileWorkplaceDraft {
  readonly sourceExperienceId: string;
  readonly company: string;
  readonly title: string;
  readonly startDate: string;
}

export function CareerDiaryProfileSetupDialog({
  experiences,
  saving,
  error,
  onClose,
  onCreate,
}: {
  readonly experiences: readonly CareerDiaryProfileExperience[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onCreate: (input: CareerDiaryWorkplaceInput) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => profileWorkplaceDraft(experiences[0]!));
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDiaryAccessDialog(dialogRef, onClose);
  return (
    <CareerDiaryAccessDialogFrame
      dialogRef={dialogRef}
      title="Создать карьерный дневник"
      titleId="career-diary-profile-setup-title"
      closeLabel="Отмена"
      onClose={onClose}
    >
      <CareerDiaryProfileSetupForm
        experiences={experiences}
        draft={draft}
        saving={saving}
        error={validationError ?? error}
        setDraft={setDraft}
        setError={setValidationError}
        onClose={onClose}
        onCreate={onCreate}
      />
    </CareerDiaryAccessDialogFrame>
  );
}

interface CareerDiaryProfileSetupFormProps {
  readonly experiences: readonly CareerDiaryProfileExperience[];
  readonly draft: CareerDiaryProfileWorkplaceDraft;
  readonly saving: boolean;
  readonly error: string | null;
  readonly setDraft: (draft: CareerDiaryProfileWorkplaceDraft) => void;
  readonly setError: (error: string | null) => void;
  readonly onClose: () => void;
  readonly onCreate: (input: CareerDiaryWorkplaceInput) => Promise<boolean>;
}

function CareerDiaryProfileSetupForm({
  experiences,
  draft,
  saving,
  error,
  setDraft,
  setError,
  onClose,
  onCreate,
}: CareerDiaryProfileSetupFormProps) {
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft.company.trim() || !draft.title.trim() || !isValidDate(draft.startDate)) {
      setError('Проверьте компанию, роль и фактическую дату начала.');
      return;
    }
    setError(null);
    await onCreate({ ...draft, company: draft.company.trim(), title: draft.title.trim() });
  }
  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <div className="career-modal-body">
        <CareerDiaryProfileSetupIntro />
        <CareerDiaryProfileExperiencePicker
          experiences={experiences}
          selectedId={draft.sourceExperienceId}
          onSelect={(id) =>
            setDraft(profileWorkplaceDraft(experiences.find((item) => item.id === id)!))
          }
        />
        <CareerDiaryProfileWorkplaceFields draft={draft} onChange={setDraft} />
        <CareerDiaryAccessFormError message={error} />
      </div>
      <CareerDiaryAccessDialogFooter
        saving={saving}
        cancelLabel="Отмена"
        submitLabel="Создать дневник"
        onCancel={onClose}
      />
    </form>
  );
}

function CareerDiaryProfileSetupIntro() {
  return (
    <p className="career-diary-note">
      Значения взяты из профиля; проверьте их и укажите фактическую дату.
    </p>
  );
}

function CareerDiaryProfileExperiencePicker({
  experiences,
  selectedId,
  onSelect,
}: {
  readonly experiences: readonly CareerDiaryProfileExperience[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}) {
  if (experiences.length === 1) return null;
  return (
    <label className="career-field" htmlFor="career-diary-profile-experience">
      Место работы из профиля
      <select
        className="career-select"
        id="career-diary-profile-experience"
        value={selectedId}
        onChange={(event) => onSelect(event.currentTarget.value)}
      >
        {experiences.map((item) => (
          <option key={item.id} value={item.id}>
            {item.employer ?? 'Компания не указана'} · {item.title ?? 'Роль не указана'}
          </option>
        ))}
      </select>
    </label>
  );
}

function CareerDiaryProfileWorkplaceFields({
  draft,
  onChange,
}: {
  readonly draft: CareerDiaryProfileWorkplaceDraft;
  readonly onChange: (draft: CareerDiaryProfileWorkplaceDraft) => void;
}) {
  return (
    <>
      <label className="career-field" htmlFor="career-diary-profile-company">
        Компания
        <input
          className="career-input"
          id="career-diary-profile-company"
          value={draft.company}
          onChange={(event) => onChange({ ...draft, company: event.currentTarget.value })}
        />
      </label>
      <label className="career-field" htmlFor="career-diary-profile-title">
        Роль
        <input
          className="career-input"
          id="career-diary-profile-title"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })}
        />
      </label>
      <label className="career-field" htmlFor="career-diary-profile-start-date">
        Дата начала
        <input
          className="career-input"
          id="career-diary-profile-start-date"
          type="date"
          value={draft.startDate}
          onChange={(event) => onChange({ ...draft, startDate: event.currentTarget.value })}
        />
      </label>
    </>
  );
}

function profileWorkplaceDraft(
  experience: CareerDiaryProfileExperience,
): CareerDiaryProfileWorkplaceDraft {
  return {
    sourceExperienceId: experience.id,
    company: experience.employer ?? '',
    title: experience.title ?? '',
    startDate: isValidDate(experience.startDate ?? '') ? experience.startDate! : '',
  };
}

export interface CareerDiaryRoleChangeDialogProps {
  readonly currentWorkplace: CareerDiaryWorkplace;
  readonly profileRole: string;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onKeepCurrent: () => Promise<boolean>;
  readonly onStartNew: (startDate: string) => Promise<boolean>;
}

export function CareerDiaryRoleChangeDialog(props: CareerDiaryRoleChangeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDiaryAccessDialog(dialogRef, props.onClose);
  return (
    <CareerDiaryAccessDialogFrame
      dialogRef={dialogRef}
      title="Роль в профиле изменилась"
      titleId="career-diary-role-change-title"
      closeLabel="Позже"
      onClose={props.onClose}
    >
      <CareerDiaryRoleChangeForm {...props} />
    </CareerDiaryAccessDialogFrame>
  );
}

function CareerDiaryRoleChangeForm({
  currentWorkplace,
  profileRole,
  saving,
  error,
  onClose,
  onKeepCurrent,
  onStartNew,
}: CareerDiaryRoleChangeDialogProps) {
  const [choice, setChoice] = useState<'keep' | 'new'>('keep');
  const [startDate, setStartDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (choice === 'keep') {
      if (await onKeepCurrent()) onClose();
      return;
    }
    if (!isValidDate(startDate)) {
      setDateError('Укажите фактическую дату выхода на новую роль.');
      return;
    }
    setDateError(null);
    if (await onStartNew(startDate)) onClose();
  }
  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <div className="career-modal-body">
        <CareerDiaryRoleChangeIntro workplace={currentWorkplace} profileRole={profileRole} />
        <CareerDiaryRoleChangeOptions
          choice={choice}
          onSelect={setChoice}
          startDate={startDate}
          onStartDateChange={setStartDate}
        />
        <CareerDiaryAccessFormError message={dateError ?? error} />
      </div>
      <CareerDiaryAccessDialogFooter
        saving={saving}
        cancelLabel="Позже"
        submitLabel="Подтвердить"
        onCancel={onClose}
      />
    </form>
  );
}

function CareerDiaryRoleChangeIntro({
  workplace,
  profileRole,
}: {
  readonly workplace: CareerDiaryWorkplace;
  readonly profileRole: string;
}) {
  return (
    <p className="career-diary-note">
      В «{workplace.company}» в профиле теперь указана роль «{profileRole}» вместо «
      {workplace.title}». Что сделать с дневником?
    </p>
  );
}

function CareerDiaryAccessDialogFrame({
  dialogRef,
  title,
  titleId,
  closeLabel,
  onClose,
  children,
}: {
  readonly dialogRef: RefObject<HTMLDialogElement>;
  readonly title: string;
  readonly titleId: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      open
      className="career-modal-backdrop career-diary-access-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="career-modal-card is-detail career-diary-access-dialog__card">
        <header className="career-modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            className="career-btn is-ghost is-icon"
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function CareerDiaryRoleChangeOptions({
  choice,
  onSelect,
  startDate,
  onStartDateChange,
}: {
  readonly choice: 'keep' | 'new';
  readonly onSelect: (choice: 'keep' | 'new') => void;
  readonly startDate: string;
  readonly onStartDateChange: (date: string) => void;
}) {
  return (
    <>
      <CareerDiaryRoleChoice
        value="keep"
        selected={choice === 'keep'}
        onSelect={onSelect}
        title="Оставить текущий дневник"
      >
        Переименовать роль в этой записи; цели, разборы и достижения сохранятся.
      </CareerDiaryRoleChoice>
      <CareerDiaryRoleChoice
        value="new"
        selected={choice === 'new'}
        onSelect={onSelect}
        title="Начать новый дневник"
      >
        Текущая запись станет архивной. Укажите фактическую дату начала новой роли.
      </CareerDiaryRoleChoice>
      {choice === 'new' ? (
        <CareerDiaryNewRoleDate value={startDate} onChange={onStartDateChange} />
      ) : null}
      {choice === 'new' ? (
        <p className="career-diary-note">
          Цели не привязаны к месту работы и останутся в общем списке дневника.
        </p>
      ) : null}
    </>
  );
}

function CareerDiaryNewRoleDate({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (date: string) => void;
}) {
  return (
    <label className="career-field" htmlFor="career-diary-new-role-date">
      Дата выхода на новую роль
      <input
        className="career-input"
        id="career-diary-new-role-date"
        type="date"
        required
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function CareerDiaryAccessFormError({ message }: { readonly message: string | null }) {
  return message ? (
    <p className="career-diary-error" role="alert">
      {message}
    </p>
  ) : null;
}

function CareerDiaryAccessDialogFooter({
  saving,
  cancelLabel,
  submitLabel,
  submitDisabled = false,
  onCancel,
}: {
  readonly saving: boolean;
  readonly cancelLabel: string;
  readonly submitLabel: string;
  readonly submitDisabled?: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <footer className="career-modal-footer career-diary-access-dialog__footer">
      <button className="career-btn is-ghost" type="button" disabled={saving} onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        className="career-btn is-primary"
        type="submit"
        disabled={saving || submitDisabled}
        aria-busy={saving}
      >
        {saving ? 'Сохраняем…' : submitLabel}
      </button>
    </footer>
  );
}

function CareerDiaryRoleChoice({
  value,
  selected,
  onSelect,
  title,
  children,
}: {
  readonly value: 'keep' | 'new';
  readonly selected: boolean;
  readonly onSelect: (value: 'keep' | 'new') => void;
  readonly title: string;
  readonly children: string;
}) {
  return (
    <label className={`career-diary-access-choice${selected ? ' is-selected' : ''}`}>
      <input
        aria-label={`${title}. ${children}`}
        type="radio"
        name="career-diary-role-choice"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
      />
      <span>
        <strong>{title}</strong>
        <small>{children}</small>
      </span>
    </label>
  );
}

interface CareerDiaryPrimaryPlaceDialogProps {
  readonly workplaces: readonly CareerDiaryWorkplace[];
  readonly currentId: string;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSave: (workplaceId: string) => Promise<void>;
}

export function CareerDiaryPrimaryPlaceDialog(props: CareerDiaryPrimaryPlaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDiaryAccessDialog(dialogRef, props.onClose);
  return (
    <CareerDiaryAccessDialogFrame
      dialogRef={dialogRef}
      title="Какое место основное?"
      titleId="career-diary-primary-title"
      closeLabel="Отмена"
      onClose={props.onClose}
    >
      <CareerDiaryPrimaryPlaceForm {...props} />
    </CareerDiaryAccessDialogFrame>
  );
}

function CareerDiaryPrimaryPlaceForm({
  workplaces,
  currentId,
  saving,
  error,
  onClose,
  onSave,
}: CareerDiaryPrimaryPlaceDialogProps) {
  const [selectedId, setSelectedId] = useState(currentId);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onSave(selectedId);
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="career-modal-body">
        <p className="career-diary-note">
          Дневник ведётся по одному месту работы; остальные записи доступны отдельно.
        </p>
        <fieldset className="career-diary-access-places">
          <legend>Основное место работы</legend>
          <CareerDiaryPrimaryPlaces
            workplaces={workplaces}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </fieldset>
        <CareerDiaryAccessFormError message={error} />
      </div>
      <CareerDiaryAccessDialogFooter
        saving={saving}
        cancelLabel="Отмена"
        submitLabel="Сделать основным"
        submitDisabled={selectedId === currentId}
        onCancel={onClose}
      />
    </form>
  );
}

function CareerDiaryPrimaryPlaces({
  workplaces,
  selectedId,
  onSelect,
}: {
  readonly workplaces: readonly CareerDiaryWorkplace[];
  readonly selectedId: string;
  readonly onSelect: (workplaceId: string) => void;
}) {
  return workplaces.map((workplace) => (
    <label
      className={`career-diary-access-choice${selectedId === workplace.id ? ' is-selected' : ''}`}
      key={workplace.id}
    >
      <input
        aria-label={`${workplace.company}. ${workplace.title}. Начало: ${workplace.startDate}`}
        type="radio"
        name="career-diary-primary-place"
        value={workplace.id}
        checked={selectedId === workplace.id}
        onChange={() => onSelect(workplace.id)}
      />
      <span>
        <strong>
          {workplace.company} · {workplace.title}
        </strong>
        <small>Начало: {workplace.startDate}</small>
      </span>
    </label>
  ));
}

function useDiaryAccessDialog(ref: RefObject<HTMLDialogElement>, onClose: () => void) {
  useEscapeLayer(onClose);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [ref]);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function trapDialogFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
