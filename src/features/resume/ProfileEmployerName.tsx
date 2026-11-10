import { useId, useState } from 'react';
import { asksEmployerName, EMPLOYER_QUESTION_ATTRIBUTE } from './hiddenEmployers';
import { answerEmployerName, type EmployerNameAnswer } from './employerNameApi';
import type { ResumeExperienceInput } from './resumeTypes';
import './profileEmployerName.css';

type Refresh = () => Promise<void> | void;

const NOT_SAVED = 'Не сохранилось: нет связи с сервером. Попробуйте ещё раз.';
const EMPTY_NAME = 'Напишите название компании.';

export interface ProfileEmployerNameProps {
  /** Позиции одного работодателя: название одно на все. */
  readonly place: Pick<ResumeExperienceInput, 'employer' | 'employerRealName' | 'employerMaskKept'>;
  readonly onChanged?: Refresh;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : NOT_SAVED;
}

function useAnswer(employer: string, onChanged?: Refresh) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (answer: EmployerNameAnswer): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await answerEmployerName(employer, answer, crypto.randomUUID());
      await onChanged?.();
      return true;
    } catch (reason) {
      setError(messageOf(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, send };
}

function ErrorLine({ error }: { readonly error: string | null }) {
  return error ? (
    <p className="career-resume-error" role="alert">
      {error}
    </p>
  ) : null;
}

/** Первый ответ: «Это и есть название»; при исправлении сохранённого названия — «Отмена». */
function SecondaryAction({
  busy,
  onCancel,
  onKeep,
}: {
  readonly busy: boolean;
  readonly onCancel?: () => void;
  readonly onKeep: () => void;
}) {
  return (
    <button
      type="button"
      className="career-btn is-sm is-ghost pm-text"
      disabled={busy}
      onClick={onCancel ?? onKeep}
    >
      {onCancel ? 'Отмена' : 'Это и есть название'}
    </button>
  );
}

/** B640: одна строка под шапкой компании, до пунктов места — иначе вопрос теряется внизу группы. */
function QuestionLabel({
  inputId,
  editing,
}: {
  readonly inputId: string;
  readonly editing: boolean;
}) {
  return (
    <label className="profile-employer-name__label" htmlFor={inputId}>
      {editing
        ? 'Настоящее название компании'
        : 'Название скрыто? Как называется компания на самом деле'}
    </label>
  );
}

function NameInput(props: {
  readonly id: string;
  readonly value: string;
  readonly invalid: boolean;
  readonly busy: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <input
      id={props.id}
      value={props.value}
      maxLength={120}
      autoComplete="organization"
      placeholder="Например, Сбер"
      aria-invalid={props.invalid || undefined}
      disabled={props.busy}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function SaveButton({ busy }: { readonly busy: boolean }) {
  return (
    <button
      type="submit"
      className="career-btn career-btn-primary career-btn-sm pm-cta is-inline"
      disabled={busy}
    >
      {busy ? 'Сохраняю…' : 'Сохранить'}
    </button>
  );
}

function NameForm({
  employer,
  initial,
  onDone,
  onChanged,
  onCancel,
}: {
  readonly employer: string;
  readonly initial: string;
  readonly onDone: () => void;
  readonly onChanged?: Refresh;
  readonly onCancel?: () => void;
}) {
  const inputId = useId();
  const [name, setName] = useState(initial);
  const { busy, error, setError, send } = useAnswer(employer, onChanged);
  const save = async () => {
    if (!name.trim()) return setError(EMPTY_NAME);
    if (await send({ name: name.trim() })) onDone();
  };
  return (
    <form
      className="profile-employer-name"
      aria-busy={busy}
      {...{ [EMPLOYER_QUESTION_ATTRIBUTE]: '' }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="profile-employer-name__row">
        <QuestionLabel inputId={inputId} editing={Boolean(onCancel)} />
        <NameInput
          id={inputId}
          value={name}
          invalid={error === EMPTY_NAME}
          busy={busy}
          onChange={setName}
        />
        <SaveButton busy={busy} />
        <SecondaryAction
          busy={busy}
          onCancel={onCancel}
          onKeep={() => void send({ keepAsIs: true }).then((ok) => ok && onDone())}
        />
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

function SavedName({
  employer,
  name,
  onEdit,
  onChanged,
}: {
  readonly employer: string;
  readonly name: string;
  readonly onEdit: () => void;
  readonly onChanged?: Refresh;
}) {
  const { busy, error, send } = useAnswer(employer, onChanged);
  return (
    <div className="profile-employer-name is-saved" aria-busy={busy}>
      <p className="profile-employer-name__saved">
        Настоящее название: <b>{name}</b>
      </p>
      <div className="profile-employer-name__row">
        <button
          type="button"
          className="career-btn is-sm is-ghost pm-text"
          disabled={busy}
          onClick={onEdit}
        >
          Изменить
        </button>
        <button
          type="button"
          className="career-btn is-sm is-ghost pm-text"
          disabled={busy}
          onClick={() => void send({ keepAsIs: true })}
        >
          {busy ? 'Убираю…' : 'Убрать'}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * B639: маска работодателя для LinkedIn («Enterprise Energy IT Services») в письмах не годится. Кандидат
 * называет компанию один раз; ответ становится подтверждённым фактом. «Это и есть название» снимает вопрос.
 */
export function ProfileEmployerName({ place, onChanged }: ProfileEmployerNameProps) {
  const employer = place.employer?.trim() ?? '';
  const realName = place.employerRealName?.trim() ?? '';
  const [editing, setEditing] = useState(false);
  if (!realName && !asksEmployerName(place)) return null;
  if (realName && !editing) {
    return (
      <SavedName
        employer={employer}
        name={realName}
        onEdit={() => setEditing(true)}
        onChanged={onChanged}
      />
    );
  }
  return (
    <NameForm
      employer={employer}
      initial={realName}
      onDone={() => setEditing(false)}
      onChanged={onChanged}
      {...(realName ? { onCancel: () => setEditing(false) } : {})}
    />
  );
}
