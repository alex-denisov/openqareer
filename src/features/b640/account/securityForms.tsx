import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  requestAccountEmailChange,
  verifyAccountEmailChange,
} from '../../account/accountEmailChangeApi';
import { CoachApiError } from '../../coach/apiClient';
import { changePassword, updateAccountProfile } from '../../coach/coachApi';
import type { AccountSnapshot } from '../../coach/cabinetTypes';
import { Icon } from '../kit/Icon';

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'password' | 'email';
  readonly autoComplete: string;
  readonly inputMode?: 'numeric';
  readonly error?: string;
}

/** Поле формы настроек (`div.cn-f.is-wide`); ошибка поля — под ним. */
function Field({ label, value, onChange, type = 'text', autoComplete, inputMode, error }: FieldProps) {
  const id = useId();
  return (
    <div className="cn-f is-wide">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p className="set-res is-err" role="alert" id={`${id}-error`}>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

interface FormShellProps {
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly error: string | null;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}

/** Форма на месте строки (`li.set-row.is-block > form.c5-form`), как смена пароля в макете N4b. */
function FormShell(props: FormShellProps) {
  const { submitLabel, busy, canSubmit, error, onSubmit, onCancel, children } = props;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit && !busy) onSubmit();
  }
  return (
    <li className="set-row is-block is-next">
      <form className="c5-form" onSubmit={submit}>
        {children}
        {error ? (
          <p className="set-res is-err" role="alert">
            <span>{error}</span>
          </p>
        ) : null}
        <div className="actions">
          <button className="btn is-primary" type="submit" disabled={!canSubmit || busy} aria-busy={busy || undefined}>
            <Icon name="check" />
            {submitLabel}
          </button>
          <button className="row-act" type="button" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </form>
    </li>
  );
}

interface Failure {
  readonly message: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** Отправка формы: ожидание, ошибка общая и по полям; введённое остаётся в полях. */
function useSubmit<T>(action: () => Promise<T>, onDone: (result: T) => void, fallback: string) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      onDone(await action());
    } catch (error) {
      const known = error instanceof CoachApiError;
      setFailure({ message: known ? error.message : fallback, fields: known ? error.fields : {} });
    } finally {
      setBusy(false);
    }
  }
  return { busy, failure, submit: () => void submit() };
}

export interface FormProps<T> {
  readonly onDone: (result: T) => void;
  readonly onCancel: () => void;
}

/** N4b: смена пароля. Новый пароль набирается дважды и сверяется до отправки. */
export function PasswordForm({ onDone, onCancel }: FormProps<void>) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const mismatch = repeat.length > 0 && repeat !== next;
  const { busy, failure, submit } = useSubmit(
    () => changePassword({ currentPassword: current, newPassword: next }),
    () => onDone(),
    'Пароль не сохранился',
  );
  return (
    <FormShell
      submitLabel="Сохранить пароль"
      busy={busy}
      canSubmit={Boolean(current && next && repeat) && !mismatch}
      error={failure && Object.keys(failure.fields).length === 0 ? failure.message : null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field
        label="Текущий пароль"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={setCurrent}
        error={failure?.fields.currentPassword}
      />
      <Field
        label="Новый пароль"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={setNext}
        error={failure?.fields.newPassword}
      />
      <Field
        label="Повторите новый пароль"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={setRepeat}
        error={mismatch ? 'Пароли не совпадают' : undefined}
      />
    </FormShell>
  );
}

export function NameForm({ name, onDone, onCancel }: FormProps<AccountSnapshot> & { readonly name: string }) {
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  const { busy, failure, submit } = useSubmit(
    () => updateAccountProfile({ displayName: trimmed }),
    onDone,
    'Имя не сохранилось',
  );
  return (
    <FormShell
      submitLabel="Сохранить имя"
      busy={busy}
      canSubmit={trimmed.length > 0 && trimmed !== name}
      error={failure?.message ?? null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Имя" autoComplete="name" value={value} onChange={setValue} />
    </FormShell>
  );
}

/** Новая почта: адрес и текущий пароль; дальше — код из письма (`EmailCodeForm`). */
export function EmailForm({ onDone, onCancel }: FormProps<{ readonly pending: boolean }>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, failure, submit } = useSubmit(
    () => requestAccountEmailChange({ email: email.trim(), currentPassword: password }),
    (result) => onDone({ pending: result.status === 'pending' }),
    'Почта не сохранилась',
  );
  return (
    <FormShell
      submitLabel="Получить код"
      busy={busy}
      canSubmit={email.trim().includes('@') && password.length > 0}
      error={failure && Object.keys(failure.fields).length === 0 ? failure.message : null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field
        label="Новая почта"
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        error={failure?.fields.email}
      />
      <Field
        label="Текущий пароль"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={failure?.fields.currentPassword}
      />
    </FormShell>
  );
}

export function EmailCodeForm({ email, onDone, onCancel }: FormProps<void> & { readonly email: string }) {
  const [code, setCode] = useState('');
  const { busy, failure, submit } = useSubmit(
    () => verifyAccountEmailChange(code.trim()),
    () => onDone(),
    'Код не подошёл',
  );
  return (
    <FormShell
      submitLabel="Подтвердить почту"
      busy={busy}
      canSubmit={code.trim().length > 0}
      error={failure?.message ?? null}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field
        label={`Код из письма на ${email}`}
        autoComplete="one-time-code"
        inputMode="numeric"
        value={code}
        onChange={setCode}
      />
    </FormShell>
  );
}
