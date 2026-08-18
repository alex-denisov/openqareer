import React, { useState } from 'react';
import { BrandMark } from '../brand/BrandMark';
import { login, register, CoachApiError, type AuthUser } from '../coach/coachApi';

interface AuthPageProps {
  onNavigate: (path: string) => void;
  onSessionChange?: (session: AuthUser | null) => void;
  nextPath?: string;
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
  return (
    <div className="auth-card-header">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onNavigate('/');
        }}
        aria-label="На главную"
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <input
        id={id}
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
      onNavigate(nextPath);
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
        <div className="career-cabinet-global-error" role="alert" style={{ marginBottom: '16px' }}>{form.error}</div>
      ) : null}
      <form className="auth-form" onSubmit={form.handleSubmit}>
        <AuthInputField id="login-identifier" label="Email или логин" autoComplete="username" placeholder="candidate@example.com" value={form.identifier} onChange={form.setIdentifier} disabled={form.busy} error={form.fieldErrors.username} required />
        <AuthInputField id="login-password" label="Пароль" type="password" autoComplete="current-password" placeholder="••••••••" value={form.password} onChange={form.setPassword} disabled={form.busy} error={form.fieldErrors.password} action={forgotBtn} required />
        <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={form.busy}>
          {form.busy ? 'Входим...' : 'Войти в кабинет'}
        </button>
      </form>
    </>
  );
}

export function LoginPage({ onNavigate, onSessionChange, nextPath = '/app' }: AuthPageProps) {
  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <AuthCardHeader title="Вход в кабинет" subtitle="Введите ваш email или логин для доступа к профилю" onNavigate={onNavigate} />
        <LoginForm onNavigate={onNavigate} onSessionChange={onSessionChange} nextPath={nextPath} />
        <div className="auth-links">
          <span>Ещё нет аккаунта? <button type="button" onClick={() => onNavigate('/signup')}>Зарегистрироваться</button></span>
          <button type="button" onClick={() => onNavigate('/')}>← Вернуться на главную</button>
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

function SignupForm({
  onNavigate,
  onSessionChange,
  nextPath,
}: AuthPageProps & { nextPath: string }) {
  const form = useSignupForm({ onNavigate, onSessionChange, nextPath });

  return (
    <>
      {form.error ? (
        <div className="career-cabinet-global-error" role="alert" style={{ marginBottom: '16px' }}>{form.error}</div>
      ) : null}
      <form className="auth-form" onSubmit={form.handleSubmit}>
        <AuthInputField id="signup-email" label="Email" type="email" autoComplete="email" placeholder="candidate@example.com" value={form.email} onChange={form.setEmail} disabled={form.busy} error={form.fieldErrors.email} required />
        <AuthInputField id="signup-name" label="Как к вам обращаться" autoComplete="name" placeholder="Алексей" value={form.displayName} onChange={form.setDisplayName} disabled={form.busy} />
        <AuthInputField id="signup-password" label="Пароль (от 8 символов)" type="password" autoComplete="new-password" placeholder="Минимум 8 символов" value={form.password} onChange={form.setPassword} disabled={form.busy} error={form.fieldErrors.password} required />
        <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={form.busy}>
          {form.busy ? 'Создаём...' : 'Создать аккаунт'}
        </button>
      </form>
    </>
  );
}

export function SignupPage({ onNavigate, onSessionChange, nextPath = '/app' }: AuthPageProps) {
  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <AuthCardHeader title="Создать аккаунт" subtitle="Начните доказательную карьерную диагностику" onNavigate={onNavigate} />
        <SignupForm onNavigate={onNavigate} onSessionChange={onSessionChange} nextPath={nextPath} />
        <div className="auth-links">
          <span>Уже есть аккаунт? <button type="button" onClick={() => onNavigate('/login')}>Войти</button></span>
          <button type="button" onClick={() => onNavigate('/')}>← Вернуться на главную</button>
        </div>
      </div>
    </div>
  );
}

function ResetForm({ onSent }: { onSent: () => void }) {
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSent();
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label htmlFor="reset-email">Email аккаунта</label>
        <input id="reset-email" type="email" placeholder="candidate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <button type="submit" className="site-btn is-primary auth-submit-btn">Отправить ссылку для сброса</button>
    </form>
  );
}

export function ResetPasswordPage({ onNavigate }: AuthPageProps) {
  const [sent, setSent] = useState(false);

  return (
    <div className="auth-page-container">
      <div className="auth-card">
        <AuthCardHeader
          title="Восстановление доступа"
          subtitle={sent ? 'Если аккаунт существует, инструкция по сбросу отправлена на указанный email' : 'Укажите email, привязанный к вашему аккаунту'}
          onNavigate={onNavigate}
        />
        {!sent ? <ResetForm onSent={() => setSent(true)} /> : (
          <button type="button" className="site-btn is-secondary auth-submit-btn" onClick={() => onNavigate('/login')}>
            Вернуться к форме входа
          </button>
        )}
        <div className="auth-links">
          <button type="button" onClick={() => onNavigate('/login')}>← Назад ко входу</button>
        </div>
      </div>
    </div>
  );
}
