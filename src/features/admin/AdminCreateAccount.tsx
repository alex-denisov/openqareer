import { useState, type FormEvent } from 'react';
import { UserPlus } from '@phosphor-icons/react';
import { CoachApiError } from '../coach/apiClient';
import { createAdminAccount, type AdminUser, type SubscriptionTier } from './adminApi';

const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GENERATED_PASSWORD_LENGTH = 16;

export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join('');
}

interface FormValues {
  displayName: string;
  email: string;
  password: string;
  emailVerified: boolean;
  tier: SubscriptionTier;
}

const EMPTY: FormValues = {
  displayName: '',
  email: '',
  password: '',
  emailVerified: true,
  tier: 'free',
};

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string; fields: Record<string, string> }
  | { kind: 'created'; user: AdminUser; password: string };

export function AdminCreateAccount({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    try {
      const user = await createAdminAccount({
        displayName: values.displayName,
        email: values.email,
        password: values.password,
        emailVerified: values.emailVerified,
        subscriptionTier: values.tier,
      });
      setStatus({ kind: 'created', user, password: values.password });
      setValues(EMPTY);
      onCreated();
    } catch (error) {
      const fields = error instanceof CoachApiError ? error.fields : {};
      const message = error instanceof Error ? error.message : 'Не удалось создать аккаунт.';
      setStatus({ kind: 'error', message, fields });
    }
  };

  if (!open) {
    return (
      <button className="admin-btn admin-btn--primary" type="button" onClick={() => setOpen(true)}>
        <UserPlus size={16} />
        Создать аккаунт
      </button>
    );
  }
  return (
    <CreateAccountPanel
      values={values}
      set={set}
      status={status}
      onSubmit={submit}
      onClose={() => {
        setOpen(false);
        setStatus({ kind: 'idle' });
      }}
    />
  );
}

type SetValue = <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;

function CreateAccountPanel({
  values,
  set,
  status,
  onSubmit,
  onClose,
}: {
  values: FormValues;
  set: SetValue;
  status: Status;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const fields = status.kind === 'error' ? status.fields : {};
  return (
    <section className="admin-panel admin-create-account" aria-labelledby="admin-create-title">
      <h2 id="admin-create-title" className="admin-form-subtitle">
        Новый аккаунт кандидата
      </h2>
      <p className="admin-note">
        Без письма и без лимита регистраций. Соглашение принимается от вашего имени, действие
        попадает в журнал.
      </p>
      <form className="admin-form" onSubmit={onSubmit} noValidate>
        <div className="admin-form-grid">
          <Field
            id="create-email"
            label="Почта"
            type="email"
            value={values.email}
            error={fields.email}
            onChange={(v) => set('email', v)}
          />
          <Field
            id="create-name"
            label="Имя"
            value={values.displayName}
            error={fields.displayName}
            onChange={(v) => set('displayName', v)}
          />
          <PasswordAndTierFields values={values} set={set} error={fields.password} />
          <VerifiedField checked={values.emailVerified} set={set} />
        </div>
        <CreateStatus status={status} />
        <CreateActions saving={status.kind === 'saving'} onClose={onClose} />
      </form>
    </section>
  );
}

function VerifiedField({ checked, set }: { checked: boolean; set: SetValue }) {
  return (
    <label className="admin-form-group admin-form-group--full admin-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => set('emailVerified', e.target.checked)}
      />
      Почта подтверждена (иначе кандидату уйдёт письмо с кодом)
    </label>
  );
}

function CreateActions({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <div className="admin-form-actions">
      <button className="admin-btn is-secondary" type="button" onClick={onClose}>
        Закрыть
      </button>
      <button className="admin-btn admin-btn--primary" type="submit" disabled={saving}>
        {saving ? 'Создание…' : 'Создать'}
      </button>
    </div>
  );
}

function CreateStatus({ status }: { status: Status }) {
  if (status.kind === 'error') {
    // A field error is already shown under its field; repeat nothing.
    if (Object.keys(status.fields).length > 0) return null;
    return (
      <p className="admin-field-error" role="alert">
        {status.message}
      </p>
    );
  }
  if (status.kind !== 'created') return null;
  return (
    <p className="admin-note" role="status">
      Аккаунт создан: {status.user.email ?? status.user.username}. Пароль:{' '}
      <code>{status.password}</code> — сохраните его сейчас, повторно он не показывается.
    </p>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
}) {
  return (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="admin-input"
        value={value}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p className="admin-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PasswordAndTierFields({
  values,
  set,
  error,
}: {
  values: FormValues;
  set: SetValue;
  error?: string;
}) {
  return (
    <>
      <PasswordField value={values.password} set={set} error={error} />
      <div className="admin-form-group">
        <label className="admin-label" htmlFor="create-tier">
          Тариф
        </label>
        <select
          id="create-tier"
          className="admin-select"
          value={values.tier}
          onChange={(e) => set('tier', e.target.value as SubscriptionTier)}
        >
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="executive">Executive</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>
    </>
  );
}

function PasswordField({ value, set, error }: { value: string; set: SetValue; error?: string }) {
  return (
    <div className="admin-form-group">
      <label className="admin-label" htmlFor="create-password">
        Пароль
      </label>
      <div className="admin-form-inline">
        <input
          id="create-password"
          className="admin-input"
          type="text"
          autoComplete="new-password"
          value={value}
          onChange={(e) => set('password', e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        <button
          className="admin-btn is-secondary"
          type="button"
          onClick={() => set('password', generatePassword())}
        >
          Сгенерировать
        </button>
      </div>
      {error ? (
        <p className="admin-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
