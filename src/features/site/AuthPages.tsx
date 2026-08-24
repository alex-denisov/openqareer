import React, { useEffect, useRef, useState } from 'react';
import { BrandMark } from '../brand/BrandMark';
import {
  login,
  register,
  requestPasswordReset,
  CoachApiError,
  type AuthUser,
} from '../coach/coachApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';

interface AuthPageProps {
  onNavigate: (path: string) => void;
  onSessionChange?: (session: AuthUser | null) => void;
  nextPath?: string;
}

function generateSecurePassword(length = 16): string {
  const lowercase = 'abcdefghijkmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*()_+-=';
  const all = lowercase + uppercase + digits + symbols;

  const array = new Uint32Array(length);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 1000000);
    }
  }

  const result: string[] = [
    lowercase[array[0] % lowercase.length],
    uppercase[array[1] % uppercase.length],
    digits[array[2] % digits.length],
    symbols[array[3] % symbols.length],
  ];

  for (let i = 4; i < length; i++) {
    result.push(all[array[i] % all.length]);
  }

  for (let i = result.length - 1; i > 0; i--) {
    const j = array[i] % (i + 1);
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }

  return result.join('');
}

function AuthCardHeader({
  title,
  subtitle,
  onNavigate,
}: {
  title: string;
  subtitle: string;
  onNavigate: (path: string) => void;
}) {
  const isDesktop = isTauriEnvironment();
  return (
    <div className="auth-card-header">
      <a
        href="/"
        className="auth-card-logo"
        onClick={(e) => {
          e.preventDefault();
          if (!isDesktop) onNavigate('/');
        }}
        aria-label="openqareer"
      >
        <BrandMark variant="lockup" size={32} />
      </a>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

function AuthInputField({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
  placeholder,
  value,
  onChange,
  disabled,
  required,
  error,
  action,
}: {
  id: string;
  name?: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="auth-field">
      <div className="auth-field-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <input
        id={id}
        name={name || id}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
      />
      {error ? <p className="auth-field-error" role="alert">{error}</p> : null}
    </div>
  );
}

function useLoginForm({
  onNavigate,
  onSessionChange,
  nextPath,
}: AuthPageProps & { nextPath: string }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setFieldErrors({});

    if (!identifier.trim()) return setFieldErrors({ username: 'Укажите email или логин' });
    if (!password) return setFieldErrors({ password: 'Длина пароля — от 8 символов' });

    setBusy(true);
    try {
      const user = await login(identifier.trim(), password);
      onSessionChange?.(user);
      const destination = user.role === 'admin' && nextPath === '/app' ? '/admin' : nextPath;
      onNavigate(destination);
    } catch (err) {
      if (err instanceof CoachApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Не удалось войти. Проверьте данные и повторите попытку.');
      }
    } finally {
      setBusy(false);
    }
  };

  return { identifier, setIdentifier, password, setPassword, busy, error, fieldErrors, handleSubmit };
}

function LoginFormFields({
  form,
  forgotBtn,
}: {
  form: ReturnType<typeof useLoginForm>;
  forgotBtn: React.ReactNode;
}) {
  return (
    <>
      <AuthInputField
        id="login-identifier"
        name="username"
        label="Email или логин"
        autoComplete="username email"
        placeholder="candidate@example.com"
        value={form.identifier}
        onChange={form.setIdentifier}
        disabled={form.busy}
        error={form.fieldErrors.username}
        required
      />
      <AuthInputField
        id="login-password"
        name="password"
        label="Пароль"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        value={form.password}
        onChange={form.setPassword}
        disabled={form.busy}
        error={form.fieldErrors.password}
        action={forgotBtn}
        required
      />
    </>
  );
}

function LoginForm({
  onNavigate,
  onSessionChange,
  nextPath,
}: AuthPageProps & { nextPath: string }) {
  const form = useLoginForm({ onNavigate, onSessionChange, nextPath });
  const forgotBtn = (
    <button
      type="button"
      className="career-quiet-button"
      style={{ fontSize: '0.78rem', padding: '0' }}
      onClick={() => onNavigate('/reset-password')}
    >
      Забыли пароль?
    </button>
  );

  return (
    <>
      {form.error ? (
        <div className="career-cabinet-global-error" role="alert" style={{ marginBottom: '16px' }}>
          {form.error}
        </div>
      ) : null}
      <form className="auth-form" method="post" action="#" onSubmit={form.handleSubmit}>
        <LoginFormFields form={form} forgotBtn={forgotBtn} />
        <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={form.busy}>
          {form.busy ? 'Входим...' : 'Войти в кабинет'}
        </button>
      </form>
    </>
  );
}

export function LoginPage({ onNavigate, onSessionChange, nextPath = '/app' }: AuthPageProps) {
  const isDesktop = isTauriEnvironment();
  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <AuthCardHeader title="Вход в кабинет" subtitle="Введите ваш email или логин для доступа к профилю" onNavigate={onNavigate} />
        <LoginForm onNavigate={onNavigate} onSessionChange={onSessionChange} nextPath={nextPath} />
        <div className="auth-links">
          <span>Ещё нет аккаунта? <button type="button" onClick={() => onNavigate('/signup')}>Зарегистрироваться</button></span>
          {!isDesktop ? (
            <button type="button" onClick={() => onNavigate('/')}>← Вернуться на главную</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function validateSignup(email: string, pass: string): Record<string, string> | null {
  if (!email.trim() || !email.includes('@')) return { email: 'Укажите корректный email' };
  if (pass.length < 8) return { password: 'Длина пароля — от 8 символов' };
  return null;
}

function useSignupForm({
  onNavigate,
  onSessionChange,
  nextPath,
}: AuthPageProps & { nextPath: string }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const validation = validateSignup(email, password);
    if (validation) return setFieldErrors(validation);
    setFieldErrors({});

    setBusy(true);
    try {
      const user = await register({ email: email.trim(), displayName: displayName.trim() || email.split('@')[0], password });
      onSessionChange?.(user);
      onNavigate(nextPath);
    } catch (err) {
      if (err instanceof CoachApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Не удалось создать аккаунт. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  };

  return { email, setEmail, displayName, setDisplayName, password, setPassword, busy, error, fieldErrors, handleSubmit };
}

function SignupPasswordSection({
  form,
  generateBtn,
  pwdNotice,
}: {
  form: ReturnType<typeof useSignupForm>;
  generateBtn: React.ReactNode;
  pwdNotice: boolean;
}) {
  return (
    <>
      <AuthInputField
        id="signup-password"
        name="password"
        label="Пароль (от 8 символов)"
        type="password"
        autoComplete="new-password"
        placeholder="Минимум 8 символов"
        value={form.password}
        onChange={form.setPassword}
        disabled={form.busy}
        error={form.fieldErrors.password}
        action={generateBtn}
        required
      />
      {pwdNotice ? (
        <p className="auth-field-notice" role="status" style={{ fontSize: '0.8rem', color: '#38d39f', margin: '-6px 0 0' }}>
          ✓ Надёжный пароль сгенерирован и готов к сохранению
        </p>
      ) : null}
    </>
  );
}

function SignupFields({
  form,
  generateBtn,
  pwdNotice,
}: {
  form: ReturnType<typeof useSignupForm>;
  generateBtn: React.ReactNode;
  pwdNotice: boolean;
}) {
  return (
    <>
      <AuthInputField
        id="signup-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email username"
        placeholder="candidate@example.com"
        value={form.email}
        onChange={form.setEmail}
        disabled={form.busy}
        error={form.fieldErrors.email}
        required
      />
      <AuthInputField
        id="signup-name"
        name="name"
        label="Как к вам обращаться"
        autoComplete="name"
        placeholder="Алексей"
        value={form.displayName}
        onChange={form.setDisplayName}
        disabled={form.busy}
      />
      <SignupPasswordSection form={form} generateBtn={generateBtn} pwdNotice={pwdNotice} />
    </>
  );
}

function SignupForm({
  onNavigate,
  onSessionChange,
  nextPath,
}: AuthPageProps & { nextPath: string }) {
  const form = useSignupForm({ onNavigate, onSessionChange, nextPath });
  const [pwdGeneratedNotice, setPwdGeneratedNotice] = useState(false);

  const handleGeneratePassword = () => {
    form.setPassword(generateSecurePassword(16));
    setPwdGeneratedNotice(true);
    setTimeout(() => setPwdGeneratedNotice(false), 4000);
  };

  const generateBtn = (
    <button
      type="button"
      className="career-quiet-button auth-generate-pwd-btn"
      style={{ fontSize: '0.78rem', padding: '0', color: 'var(--career-accent, #0a70e0)' }}
      onClick={handleGeneratePassword}
      title="Сгенерировать надёжный случайный пароль"
      aria-label="Сгенерировать надёжный пароль"
    >
      ⚡ Сгенерировать пароль
    </button>
  );

  return (
    <>
      {form.error ? (
        <div className="career-cabinet-global-error" role="alert" style={{ marginBottom: '16px' }}>
          {form.error}
        </div>
      ) : null}
      <form className="auth-form" method="post" action="#" onSubmit={form.handleSubmit}>
        <SignupFields form={form} generateBtn={generateBtn} pwdNotice={pwdGeneratedNotice} />
        <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={form.busy}>
          {form.busy ? 'Создаём...' : 'Создать аккаунт'}
        </button>
      </form>
    </>
  );
}

export function SignupPage({ onNavigate, onSessionChange, nextPath = '/app' }: AuthPageProps) {
  const isDesktop = isTauriEnvironment();
  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <AuthCardHeader title="Создать аккаунт" subtitle="Начните доказательную карьерную диагностику" onNavigate={onNavigate} />
        <SignupForm onNavigate={onNavigate} onSessionChange={onSessionChange} nextPath={nextPath} />
        <div className="auth-links">
          <span>Уже есть аккаунт? <button type="button" onClick={() => onNavigate('/login')}>Войти</button></span>
          {!isDesktop ? (
            <button type="button" onClick={() => onNavigate('/')}>← Вернуться на главную</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

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

export function ResetPasswordPage({ onNavigate }: AuthPageProps) {
  const [result, setResult] = useState<PublicPasswordResetResult>();
  const requestCompleted = result && result.status !== 'error';

  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <AuthCardHeader
          title="Восстановление доступа"
          subtitle="Укажите email, привязанный к вашему аккаунту"
          onNavigate={onNavigate}
        />
        {requestCompleted ? (
          <div className="auth-form">
            <p className="auth-field-notice" role="status">{result.message}</p>
            <button type="button" className="site-btn is-secondary auth-submit-btn" onClick={() => onNavigate('/login')}>
              Вернуться к форме входа
            </button>
          </div>
        ) : (
          <ResetForm
            onResult={setResult}
            onEdit={() => setResult(undefined)}
            errorMessage={result?.status === 'error' ? result.message : undefined}
          />
        )}
        <div className="auth-links">
          <button type="button" onClick={() => onNavigate('/login')}>← Назад ко входу</button>
        </div>
      </div>
    </div>
  );
}
