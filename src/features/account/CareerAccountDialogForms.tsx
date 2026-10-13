import { useEffect, useState, type FormEvent } from 'react';
import { AccountFormDialog } from './AccountDialogs';
import { TimezoneSelect } from '../shell/TimezoneSelect';
import { getNameError, getPasswordError, sanitizeEmail, sanitizeName } from '../../../shared/accountValidation';
import { apiErrorMessage } from '../coach/apiClient';
import { settle } from './accountDialogUtils';
import type { PendingAccountEmailChange } from './accountEmailChangeApi';

interface DialogProps {
  readonly busy: boolean;
  readonly error?: string;
  readonly onError: (message?: string) => void;
  readonly onClose: () => void;
}

export function EditNameDialog({
  value,
  onSave,
  ...props
}: DialogProps & { readonly value: string; readonly onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(value);
  return (
    <AccountFormDialog title="Изменить имя" titleId="account-edit-name-title" onClose={props.onClose}>
      <form className="career-account-form" onSubmit={(event) => void submitName(event, name, props, onSave)}>
        <label>
          <span>Имя</span>
          <input value={name} autoComplete="name" disabled={props.busy} onChange={(event) => setName(sanitizeName(event.target.value))} />
        </label>
        <DialogError error={props.error} />
        <DialogActions onClose={props.onClose} busy={props.busy} submitLabel="Сохранить" />
      </form>
    </AccountFormDialog>
  );
}

async function submitName(
  event: FormEvent<HTMLFormElement>,
  name: string,
  props: DialogProps,
  onSave: (name: string) => Promise<void>,
) {
  event.preventDefault();
  const error = getNameError(name);
  if (error) return props.onError(error);
  await settle(onSave(sanitizeName(name).trim()), props.onClose, props.onError);
}

interface EditEmailProps extends DialogProps {
  readonly email: string;
  readonly pending: PendingAccountEmailChange | null;
  readonly onRequest: (email: string, password: string) => Promise<PendingAccountEmailChange | null>;
  readonly onVerify: (code: string) => Promise<void>;
}

export function EditEmailDialog(props: EditEmailProps) {
  const state = useEmailChangeDialogState(props);
  return (
    <AccountFormDialog
      title="Изменить почту для входа"
      titleId="account-edit-email-title"
      description={state.verifying ? `Код отправлен на ${state.email}. Текущий адрес действует до подтверждения.` : undefined}
      onClose={props.onClose}
    >
      {state.verifying ? <EmailVerificationForm {...props} {...state} /> : <EmailRequestForm {...props} {...state} />}
    </AccountFormDialog>
  );
}

function useEmailChangeDialogState(props: EditEmailProps) {
  const [email, setEmail] = useState(props.pending?.email ?? props.email);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(Boolean(props.pending));
  const [resendAfter, setResendAfter] = useState(props.pending?.resendAfterSeconds ?? 0);
  useEffect(() => {
    if (!props.pending) return;
    setEmail(props.pending.email);
    setVerifying(true);
    setResendAfter(props.pending.resendAfterSeconds);
  }, [props.pending]);
  useEffect(() => {
    if (resendAfter <= 0) return undefined;
    const timer = window.setTimeout(() => setResendAfter((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendAfter]);
  return { email, setEmail, password, setPassword, code, setCode, verifying, setVerifying, resendAfter, setResendAfter };
}

type EmailDialogState = ReturnType<typeof useEmailChangeDialogState>;

function EmailRequestForm(props: EmailDialogState & EditEmailProps) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onError(undefined);
    try {
      const next = await props.onRequest(sanitizeEmail(props.email).trim(), props.password);
      if (!next) props.onClose();
      else props.setVerifying(true);
    } catch (reason) {
      props.onError(apiErrorMessage(reason, 'Не удалось запросить смену адреса.'));
    }
  }
  return (
    <form className="career-account-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>Новый email</span>
        <input type="email" value={props.email} autoComplete="email" disabled={props.busy} onChange={(event) => props.setEmail(sanitizeEmail(event.target.value))} required />
      </label>
      <PasswordField label="Текущий пароль" value={props.password} busy={props.busy} onChange={props.setPassword} required />
      <DialogError error={props.error} />
      <DialogActions onClose={props.onClose} busy={props.busy} submitLabel="Отправить код" />
    </form>
  );
}

function EmailVerificationForm(props: EmailDialogState & EditEmailProps) {
  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/u.test(props.code)) return props.onError('Введите 6 цифр из письма.');
    await settle(props.onVerify(props.code), props.onClose, props.onError);
  }
  async function resend() {
    if (props.resendAfter > 0 || !props.password) return;
    try {
      const next = await props.onRequest(props.email, props.password);
      if (next) props.setResendAfter(next.resendAfterSeconds);
    } catch (reason) {
      props.onError(apiErrorMessage(reason, 'Не удалось отправить новый код.'));
    }
  }
  return (
    <form className="career-account-form" onSubmit={(event) => void submitCode(event)}>
      <label>
        <span>Код из письма</span>
        <input value={props.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={props.busy} onChange={(event) => props.setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} required />
      </label>
      <PasswordField label="Текущий пароль для повторной отправки" value={props.password} busy={props.busy} onChange={props.setPassword} />
      <DialogError error={props.error} />
      <div className="career-account-dialog-actions">
        <button type="button" className="career-btn is-ghost" disabled={props.busy} onClick={props.onClose}>Закрыть</button>
        <button type="submit" className="career-btn" disabled={props.busy || props.code.length !== 6}>Подтвердить адрес</button>
        <button type="button" className="career-btn is-ghost" disabled={props.busy || !props.password || props.resendAfter > 0} onClick={() => void resend()}>
          {props.resendAfter > 0 ? `Новый код через ${props.resendAfter} с` : 'Отправить новый код'}
        </button>
      </div>
    </form>
  );
}

export function ChangePasswordDialog({ onSave, ...props }: DialogProps & {
  readonly onSave: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const error = getPasswordError(newPassword);
    if (error) return props.onError(error);
    await settle(onSave({ currentPassword, newPassword }), props.onClose, props.onError);
  }
  return (
    <AccountFormDialog title="Сменить пароль" titleId="account-change-password-title" onClose={props.onClose}>
      <form className="career-account-form" onSubmit={(event) => void submit(event)}>
        <PasswordField name="currentPassword" label="Текущий пароль" busy={props.busy} required />
        <PasswordField name="newPassword" label="Новый пароль" busy={props.busy} minLength={12} maxLength={256} required />
        <DialogError error={props.error} />
        <DialogActions onClose={props.onClose} busy={props.busy} submitLabel="Изменить пароль" />
      </form>
    </AccountFormDialog>
  );
}

export function TimezoneDialog({ value, onSave, ...props }: DialogProps & {
  readonly value: string;
  readonly onSave: (timezone: string | null) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await settle(onSave(String(form.get('timezone') ?? '').trim() || null), props.onClose, props.onError);
  }
  return (
    <AccountFormDialog title="Часовой пояс" titleId="account-timezone-title" onClose={props.onClose}>
      <form className="career-account-form" onSubmit={(event) => void submit(event)}>
        <TimezoneSelect name="timezone" defaultValue={value || undefined} disabled={props.busy} />
        <DialogError error={props.error} />
        <DialogActions onClose={props.onClose} busy={props.busy} submitLabel="Сохранить" />
      </form>
    </AccountFormDialog>
  );
}

export function DeleteAccountDialog({ onDelete, ...props }: DialogProps & { readonly onDelete: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== 'УДАЛИТЬ') return props.onError('Введите «УДАЛИТЬ», чтобы подтвердить удаление.');
    await settle(onDelete(), props.onClose, props.onError);
  }
  return (
    <AccountFormDialog
      title="Удалить аккаунт?"
      titleId="account-delete-title"
      description="Профиль и данные будут удалены безвозвратно через 7 дней. Передумать можно до этого срока."
      onClose={props.onClose}
    >
      <form className="career-account-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Введите УДАЛИТЬ</span>
          <input value={confirmation} autoComplete="off" disabled={props.busy} onChange={(event) => setConfirmation(event.target.value)} required />
        </label>
        <DialogError error={props.error} />
        <div className="career-account-dialog-actions">
          <button type="button" className="career-btn is-ghost" disabled={props.busy} onClick={props.onClose}>Отмена</button>
          <button type="submit" className="career-btn is-danger" disabled={props.busy || confirmation !== 'УДАЛИТЬ'}>Удалить аккаунт</button>
        </div>
      </form>
    </AccountFormDialog>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  busy,
  name,
  minLength,
  maxLength,
  required,
}: {
  readonly label: string;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly busy: boolean;
  readonly name?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly required?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        name={name}
        type="password"
        value={value}
        autoComplete={name === 'newPassword' ? 'new-password' : 'current-password'}
        minLength={minLength}
        maxLength={maxLength}
        disabled={busy}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        required={required}
      />
    </label>
  );
}

function DialogError({ error }: { readonly error?: string }) {
  return error ? <p role="alert">{error}</p> : null;
}

function DialogActions({
  onClose,
  busy,
  submitLabel,
}: {
  readonly onClose: () => void;
  readonly busy: boolean;
  readonly submitLabel: string;
}) {
  return (
    <div className="career-account-dialog-actions">
      <button type="button" className="career-btn is-ghost" disabled={busy} onClick={onClose}>Отмена</button>
      <button type="submit" className="career-btn" disabled={busy}>{submitLabel}</button>
    </div>
  );
}
