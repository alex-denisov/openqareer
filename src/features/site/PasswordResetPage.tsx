import React, { useEffect, useRef, useState } from 'react';
import {
  requestPasswordReset,
  resetPassword,
  CoachApiError,
} from '../coach/coachApi';
import { getPasswordError } from '../../../shared/accountValidation';
import { AuthCardHeader, AuthInputField } from './AuthPageComponents';
import type { AuthPageProps } from './AuthPages';

type PasswordResetRequester = (identifier: string) => Promise<boolean>;

export interface PublicPasswordResetResult {
  status: 'delivery-configured' | 'delivery-unconfigured' | 'error';
  message: string;
}

export async function requestPublicPasswordReset(
  identifier: string,
  requestReset: PasswordResetRequester = requestPasswordReset,
): Promise<PublicPasswordResetResult> {
  try {
    const deliveryConfigured = await requestReset(identifier.trim());
    return deliveryConfigured
      ? {
          status: 'delivery-configured',
          message:
            'Если аккаунт существует, письмо со ссылкой отправлено на указанный email.',
        }
      : {
          status: 'delivery-unconfigured',
          message:
            'Отправка писем пока не подключена. Доступ не изменён; восстановление станет доступно после настройки почтового домена.',
        };
  } catch (reason) {
    return {
      status: 'error',
      message:
        reason instanceof CoachApiError
          ? reason.message
          : 'Не удалось запросить восстановление доступа. Попробуйте ещё раз.',
    };
  }
}

function ResetEmailField({
  value,
  errorMessage,
  inputRef,
  onChange,
}: {
  value: string;
  errorMessage?: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="auth-field">
      <label htmlFor="reset-email">Email аккаунта</label>
      <input
        ref={inputRef}
        id="reset-email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="candidate@example.com"
        value={value}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={errorMessage ? 'reset-email-error' : undefined}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </div>
  );
}

export function ResetForm({
  onResult,
  onEdit,
  errorMessage,
}: {
  onResult: (result: PublicPasswordResetResult) => void;
  onEdit: () => void;
  errorMessage?: string;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (errorMessage) emailRef.current?.focus();
  }, [errorMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onResult(await requestPublicPasswordReset(email));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" method="post" action="#" onSubmit={handleSubmit}>
      <ResetEmailField
        value={email}
        errorMessage={errorMessage}
        inputRef={emailRef}
        onChange={(value) => {
          setEmail(value);
          if (errorMessage) onEdit();
        }}
      />
      {errorMessage ? (
        <p id="reset-email-error" className="auth-field-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={busy}>
        {busy ? 'Отправляем…' : 'Отправить ссылку для сброса'}
      </button>
    </form>
  );
}

export function getResetTokenFromSearch(search: string): string | null {
  const token = new URLSearchParams(search).get('token')?.trim();
  return token || null;
}

export function validateResetPasswordPair(
  newPassword: string,
  confirmPassword: string,
): Record<string, string> | null {
  const passwordError = getPasswordError(newPassword);
  if (passwordError) return { newPassword: passwordError };
  if (newPassword !== confirmPassword) return { confirmPassword: 'Пароли не совпадают.' };
  return null;
}

function ResetNewPasswordFields({
  newPassword,
  confirmPassword,
  fieldErrors,
  busy,
  setNewPassword,
  setConfirmPassword,
}: {
  newPassword: string;
  confirmPassword: string;
  fieldErrors: Record<string, string>;
  busy: boolean;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
}) {
  return (
    <>
      <AuthInputField
        id="reset-new-password"
        name="newPassword"
        label="Новый пароль"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={setNewPassword}
        disabled={busy}
        required
        error={fieldErrors.newPassword}
        errorId="reset-new-password-error"
      />
      <AuthInputField
        id="reset-confirm-password"
        name="confirmPassword"
        label="Повторите пароль"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        disabled={busy}
        required
        error={fieldErrors.confirmPassword}
        errorId="reset-confirm-password-error"
      />
    </>
  );
}

async function submitResetPassword({
  event,
  token,
  newPassword,
  confirmPassword,
  setBusy,
  setError,
  setFieldErrors,
  onInvalidToken,
  onNavigate,
  onSessionChange,
}: {
  event: React.FormEvent;
  token: string;
  newPassword: string;
  confirmPassword: string;
  setBusy: (busy: boolean) => void;
  setError: (message: string | undefined) => void;
  setFieldErrors: (errors: Record<string, string>) => void;
  onInvalidToken: () => void;
  onNavigate: (path: string) => void;
  onSessionChange?: AuthPageProps['onSessionChange'];
}) {
  event.preventDefault();
  const validation = validateResetPasswordPair(newPassword, confirmPassword);
  setFieldErrors(validation ?? {});
  if (validation) return;
  setError(undefined);
  setBusy(true);
  try {
    const session = await resetPassword(token, newPassword);
    onSessionChange?.(session);
    onNavigate('/app');
  } catch (reason) {
    if (reason instanceof CoachApiError && reason.code === 'password_reset_invalid') {
      onInvalidToken();
    } else {
      setError(
        reason instanceof CoachApiError
          ? reason.message
          : 'Не удалось изменить пароль. Попробуйте ещё раз.',
      );
    }
  } finally {
    setBusy(false);
  }
}

function ResetNewPasswordForm({
  token,
  onInvalidToken,
  onNavigate,
  onSessionChange,
}: AuthPageProps & { token: string; onInvalidToken: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = (event: React.FormEvent) =>
    submitResetPassword({
      event,
      token,
      newPassword,
      confirmPassword,
      setBusy,
      setError,
      setFieldErrors,
      onInvalidToken,
      onNavigate,
      onSessionChange,
    });

  return (
    <form className="auth-form" method="post" action="#" onSubmit={handleSubmit} aria-busy={busy}>
      {error ? <div className="career-cabinet-global-error auth-form-error" role="alert">{error}</div> : null}
      <ResetNewPasswordFields
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        fieldErrors={fieldErrors}
        busy={busy}
        setNewPassword={setNewPassword}
        setConfirmPassword={setConfirmPassword}
      />
      <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={busy}>
        {busy ? 'Сохраняем…' : 'Сохранить новый пароль'}
      </button>
    </form>
  );
}

interface ResetPasswordContentProps {
  resetToken: string | null;
  invalidToken: boolean;
  result?: PublicPasswordResetResult;
  onRequestNewLink: () => void;
  onInvalidToken: () => void;
  onNavigate: (path: string) => void;
  onSessionChange?: AuthPageProps['onSessionChange'];
  onResult: (result: PublicPasswordResetResult) => void;
  onEdit: () => void;
}

function InvalidResetLink({ onRequestNewLink }: { onRequestNewLink: () => void }) {
  return (
    <div className="auth-form">
      <p className="auth-field-notice" role="alert">Ссылка недействительна. Запросите новую.</p>
      <button type="button" className="site-btn is-primary auth-submit-btn" onClick={onRequestNewLink}>
        Запросить новую
      </button>
    </div>
  );
}

function ResetRequestCompleted({ result, onNavigate }: {
  result: PublicPasswordResetResult;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="auth-form">
      <p className="auth-field-notice" role="status">{result.message}</p>
      <button type="button" className="site-btn is-secondary auth-submit-btn" onClick={() => onNavigate('/login')}>
        Вернуться к форме входа
      </button>
    </div>
  );
}

function ResetPasswordContent({
  resetToken,
  invalidToken,
  result,
  onRequestNewLink,
  onInvalidToken,
  onNavigate,
  onSessionChange,
  onResult,
  onEdit,
}: ResetPasswordContentProps) {
  if (resetToken && invalidToken) {
    return <InvalidResetLink onRequestNewLink={onRequestNewLink} />;
  }
  if (resetToken) {
    return (
      <ResetNewPasswordForm
        token={resetToken}
        onInvalidToken={onInvalidToken}
        onNavigate={onNavigate}
        onSessionChange={onSessionChange}
      />
    );
  }
  if (result && result.status !== 'error') {
    return <ResetRequestCompleted result={result} onNavigate={onNavigate} />;
  }
  return (
    <ResetForm
      onResult={onResult}
      onEdit={onEdit}
      errorMessage={result?.status === 'error' ? result.message : undefined}
    />
  );
}

export function ResetPasswordPage({ onNavigate, onSessionChange }: AuthPageProps) {
  const [resetToken, setResetToken] = useState(() =>
    typeof window === 'undefined' ? null : getResetTokenFromSearch(window.location.search),
  );
  const [invalidToken, setInvalidToken] = useState(false);
  const [result, setResult] = useState<PublicPasswordResetResult>();
  const requestNewLink = () => {
    setResetToken(null);
    setInvalidToken(false);
    setResult(undefined);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', '/reset-password');
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <AuthCardHeader
          title={resetToken ? 'Новый пароль' : 'Восстановление доступа'}
          subtitle={resetToken ? 'Придумайте новый пароль для входа в аккаунт' : 'Укажите email, привязанный к вашему аккаунту'}
          onNavigate={onNavigate}
        />
        <ResetPasswordContent
          resetToken={resetToken}
          invalidToken={invalidToken}
          result={result}
          onRequestNewLink={requestNewLink}
          onInvalidToken={() => setInvalidToken(true)}
          onNavigate={onNavigate}
          onSessionChange={onSessionChange}
          onResult={setResult}
          onEdit={() => setResult(undefined)}
        />
        <div className="auth-links">
          <button type="button" onClick={() => onNavigate('/login')}>← Назад ко входу</button>
        </div>
      </div>
    </div>
  );
}
