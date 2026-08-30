import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import {
  login,
  register,
  requestPasswordReset,
  CoachApiError,
  type AuthUser,
} from '../coach/coachApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  LEGAL_DOCS,
  LEGAL_PACK_VERSION_ID,
  legalPath,
} from '../../../shared/legalRegistry';

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

/**
 * Typing a password you cannot read is how a typo becomes a locked account.
 * The control is a toggle rather than a mode switch, so a field never reveals
 * itself without being asked to.
 */
function PasswordRevealButton({
  controls,
  revealed,
  onToggle,
}: {
  controls: string;
  revealed: boolean;
  onToggle: () => void;
}) {
  const label = revealed ? 'Скрыть пароль' : 'Показать пароль';
  return (
    <button
      type="button"
      className="auth-reveal-button"
      onClick={onToggle}
      aria-pressed={revealed}
      aria-controls={controls}
      aria-label={label}
      title={label}
    >
      {revealed ? <EyeSlash size={18} /> : <Eye size={18} />}
    </button>
  );
}

interface AuthInputFieldProps {
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
  /** A secondary control rendered beside the label, e.g. «Забыли пароль?». */
  action?: React.ReactNode;
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
}: AuthInputFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="auth-field">
      <div className="auth-field-header">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <div className={isPassword ? 'auth-field-input has-reveal' : 'auth-field-input'}>
        <input
          id={id}
          name={name || id}
          type={isPassword && revealed ? 'text' : type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
        />
        {isPassword ? (
          <PasswordRevealButton
            controls={id}
            revealed={revealed}
            onToggle={() => setRevealed((current) => !current)}
          />
        ) : null}
      </div>
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
      className="career-quiet-button auth-field-action"
      onClick={() => onNavigate('/reset-password')}
    >
      Забыли пароль?
    </button>
  );

  return (
    <>
      {form.error ? (
        <div className="career-cabinet-global-error auth-form-error" role="alert">
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

export function validateSignup(
  email: string,
  pass: string,
  legalAccepted = true,
): Record<string, string> | null {
  if (!email.trim() || !email.includes('@')) return { email: 'Укажите корректный email' };
  if (pass.length < 8) return { password: 'Длина пароля — от 8 символов' };
  if (!legalAccepted) {
    return {
      legalConsent:
        'Примите пользовательское соглашение, политику обработки персональных данных и согласие — без этого регистрация невозможна.',
    };
  }
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
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const validation = validateSignup(email, password, legalAccepted);
    if (validation) return setFieldErrors(validation);
    setFieldErrors({});

    setBusy(true);
    try {
      const user = await register({
        email: email.trim(),
        displayName: displayName.trim() || email.split('@')[0],
        password,
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      });
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

  const fields = { email, setEmail, displayName, setDisplayName, password, setPassword };
  const consent = { legalAccepted, setLegalAccepted };
  return { ...fields, ...consent, busy, error, fieldErrors, handleSubmit };
}

function SignupPasswordSection({ form }: { form: ReturnType<typeof useSignupForm> }) {
  return (
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
      required
    />
  );
}

function SignupFields({ form }: { form: ReturnType<typeof useSignupForm> }) {
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
        placeholder="Например, Мария"
        value={form.displayName}
        onChange={form.setDisplayName}
        disabled={form.busy}
      />
      <SignupPasswordSection form={form} />
    </>
  );
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
        <div className="career-cabinet-global-error auth-form-error" role="alert">
          {form.error}
        </div>
      ) : null}
      <form className="auth-form" method="post" action="#" onSubmit={form.handleSubmit}>
        <SignupFields form={form} />
        <LegalConsentField
          accepted={form.legalAccepted}
          disabled={form.busy}
          error={form.fieldErrors.legalConsent}
          onChange={form.setLegalAccepted}
        />
        <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={form.busy}>
          {form.busy ? 'Создаём...' : 'Создать аккаунт'}
        </button>
      </form>
    </>
  );
}

/**
 * The acceptance is a field of the form, not a banner: registration is refused
 * without it and the accepted version travels to the server (B173).
 */
function LegalConsentField({
  accepted,
  disabled,
  error,
  onChange,
}: {
  accepted: boolean;
  disabled: boolean;
  error?: string;
  onChange: (accepted: boolean) => void;
}) {
  return (
    <div className="auth-field auth-legal-consent">
      <label htmlFor="signup-legal">
        <input
          id="signup-legal"
          name="legalConsent"
          type="checkbox"
          checked={accepted}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'signup-legal-error' : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          Я принимаю{' '}
          {LEGAL_DOCS.map((doc, index) => (
            <React.Fragment key={doc.slug}>
              {index > 0 ? (index === LEGAL_DOCS.length - 1 ? ' и ' : ', ') : null}
              <a href={legalPath(doc.slug)} target="_blank" rel="noreferrer">
                {doc.title.toLowerCase()}
              </a>
            </React.Fragment>
          ))}
          . Мне исполнилось 16 лет.
        </span>
      </label>
      {error ? (
        <p className="auth-field-error" id="signup-legal-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
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
