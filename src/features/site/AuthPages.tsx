import React, { useState } from 'react';
import { preloadCareerWorkspaceShell } from '../shell/careerWorkspaceLoader';
import { login, register, CoachApiError, TwoFactorRequiredError, type AuthUser } from '../coach/coachApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { LEGAL_DOCS, LEGAL_PACK_VERSION_ID, legalPath } from '../../../shared/legalRegistry';
import { AuthCardHeader, AuthInputField } from './AuthPageComponents';
import { TwoFactorLoginStep } from './TwoFactorLoginStep';
import { usePasskeyAutofill } from './usePasskeyAutofill';

export { AuthCardHeader, AuthInputField };
export type { AuthInputFieldProps } from './AuthPageComponents';
export {
  ResetForm,
  ResetPasswordPage,
  getResetTokenFromSearch,
  requestPublicPasswordReset,
  validateResetPasswordPair,
} from './PasswordResetPage';
export type { PublicPasswordResetResult } from './PasswordResetPage';

export interface AuthPageProps {
  onNavigate: (path: string) => void;
  onSessionChange?: (session: AuthUser | null) => void;
  nextPath?: string;
  /** Почему кандидат видит вход: например, сессия истекла (PRB-038). */
  notice?: string;
  /** Build-only first paint: disabled and inert until the client mounts. */
  bootstrapPending?: boolean;
  /** Cabinet and desktop overlays already have their own main landmark. */
  embedded?: boolean;
}

type SignedIn = (user: AuthUser) => void;

/** Куда ведёт вход: подтверждение почты, админка или запрошенная страница. */
function signedInHandler({ onNavigate, onSessionChange, nextPath }: AuthPageProps & { nextPath: string }): SignedIn {
  return (user) => {
    onSessionChange?.(user);
    const destination =
      user.emailVerified === false
        ? '/verify-email'
        : user.role === 'admin' && nextPath === '/app'
          ? '/admin'
          : nextPath;
    onNavigate(destination);
  };
}

function useLoginForm({
  bootstrapPending = false,
  onSignedIn,
  onTwoFactor,
}: {
  readonly bootstrapPending?: boolean;
  readonly onSignedIn: SignedIn;
  readonly onTwoFactor: (challenge: string) => void;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(bootstrapPending);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  usePasskeyAutofill(onSignedIn, !bootstrapPending);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setFieldErrors({});

    if (!identifier.trim()) return setFieldErrors({ username: 'Укажите email или логин' });
    if (!password) return setFieldErrors({ password: 'Введите пароль' });

    setBusy(true);
    try {
      onSignedIn(await login(identifier.trim(), password));
    } catch (err) {
      if (err instanceof TwoFactorRequiredError) {
        onTwoFactor(err.challenge);
      } else if (err instanceof CoachApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Не удалось войти. Проверьте данные и повторите попытку.');
      }
    } finally {
      setBusy(false);
    }
  };

  const fields = { bootstrapPending, identifier, setIdentifier, password, setPassword };
  return { ...fields, busy, error, fieldErrors, handleSubmit };
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
        autoComplete={form.bootstrapPending ? 'off' : 'username webauthn'}
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
        autoComplete={form.bootstrapPending ? 'off' : 'current-password'}
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
  bootstrapPending = false,
  onSignedIn,
  onTwoFactor,
}: {
  readonly onNavigate: (path: string) => void;
  readonly bootstrapPending?: boolean;
  readonly onSignedIn: SignedIn;
  readonly onTwoFactor: (challenge: string) => void;
}) {
  const form = useLoginForm({ bootstrapPending, onSignedIn, onTwoFactor });
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
      <form
        className="auth-form"
        method="post"
        action="#"
        onSubmit={form.handleSubmit}
        onFocusCapture={preloadCareerWorkspaceShell}
      >
        <LoginFormFields form={form} forgotBtn={forgotBtn} />
        <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={form.busy}>
          {form.busy ? 'Входим...' : 'Войти в кабинет'}
        </button>
      </form>
    </>
  );
}

function LoginLinks({ onNavigate }: { readonly onNavigate: (path: string) => void }) {
  return (
    <div className="auth-links">
      <span>
        Ещё нет аккаунта?{' '}
        <button type="button" onClick={() => onNavigate('/signup')}>
          Зарегистрироваться
        </button>
      </span>
      {!isTauriEnvironment() ? (
        <button type="button" onClick={() => onNavigate('/')}>
          ← Вернуться на главную
        </button>
      ) : null}
    </div>
  );
}

function TwoFactorStep({
  onBack,
  ...step
}: React.ComponentProps<typeof TwoFactorLoginStep> & { readonly onBack: () => void }) {
  return (
    <>
      <TwoFactorLoginStep {...step} />
      <div className="auth-links">
        <button type="button" onClick={onBack}>
          ← Войти с другим аккаунтом
        </button>
      </div>
    </>
  );
}

/** B401: если пароль принят, а защита включена, та же карточка просит код из приложения. */
export function LoginPage({
  onNavigate,
  onSessionChange,
  nextPath = '/app',
  notice,
  bootstrapPending = false,
  embedded = false,
}: AuthPageProps) {
  const Container = embedded ? 'div' : 'main';
  const [challenge, setChallenge] = useState<string | null>(null);
  const [restartNotice, setRestartNotice] = useState<string | null>(null);
  const onSignedIn = signedInHandler({ onNavigate, onSessionChange, nextPath });
  return (
    <Container className="auth-page-container">
      {bootstrapPending ? <p className="auth-notice" role="status">Загружаем форму…</p> : null}
      <div className="auth-card" {...(bootstrapPending ? { inert: '' } : {})}>
        <AuthCardHeader
          title="Вход в кабинет"
          subtitle={challenge ? undefined : 'Введите ваш email или логин для доступа к профилю'}
          onNavigate={onNavigate}
        />
        {challenge ? (
          <TwoFactorStep
            challenge={challenge}
            onSignedIn={onSignedIn}
            onRestart={(text) => {
              setChallenge(null);
              setRestartNotice(text);
            }}
            onBack={() => setChallenge(null)}
          />
        ) : (
          <>
            {(restartNotice ?? notice) ? <p className="auth-notice" role="status">{restartNotice ?? notice}</p> : null}
            <LoginForm
              onNavigate={onNavigate}
              bootstrapPending={bootstrapPending}
              onSignedIn={onSignedIn}
              onTwoFactor={(next) => {
                setRestartNotice(null);
                setChallenge(next);
              }}
            />
            <LoginLinks onNavigate={onNavigate} />
          </>
        )}
      </div>
    </Container>
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
  bootstrapPending = false,
}: AuthPageProps & { nextPath: string }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [busy, setBusy] = useState(bootstrapPending);
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
      onNavigate(user.emailVerified === false ? '/verify-email' : nextPath);
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
  return { ...fields, ...consent, bootstrapPending, busy, error, fieldErrors, handleSubmit };
}

function SignupPasswordSection({ form }: { form: ReturnType<typeof useSignupForm> }) {
  return (
    <AuthInputField
      id="signup-password"
      name="password"
      label="Пароль (от 8 символов)"
      type="password"
      autoComplete={form.bootstrapPending ? 'off' : 'new-password'}
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
        autoComplete={form.bootstrapPending ? 'off' : 'email'}
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
        autoComplete={form.bootstrapPending ? 'off' : 'name'}
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
  bootstrapPending = false,
}: AuthPageProps & { nextPath: string }) {
  const form = useSignupForm({ onNavigate, onSessionChange, nextPath, bootstrapPending });

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

export function SignupPage({
  onNavigate,
  onSessionChange,
  nextPath = '/app',
  bootstrapPending = false,
  embedded = false,
}: AuthPageProps) {
  const isDesktop = isTauriEnvironment();
  const Container = embedded ? 'div' : 'main';
  return (
    <Container className="auth-page-container">
      {bootstrapPending ? <p className="auth-notice" role="status">Загружаем форму…</p> : null}
      <div className="auth-card" {...(bootstrapPending ? { inert: '' } : {})}>
        <AuthCardHeader
          title="Создать аккаунт"
          subtitle="Загрузите резюме: соберём профиль, проверим на ATS и покажем вакансии с процентом совпадения. Старт бесплатно."
          onNavigate={onNavigate}
        />
        <SignupForm
          onNavigate={onNavigate}
          onSessionChange={onSessionChange}
          nextPath={nextPath}
          bootstrapPending={bootstrapPending}
        />
        <div className="auth-links">
          <span>
            Уже есть аккаунт?{' '}
            <button type="button" onClick={() => onNavigate('/login')}>
              Войти
            </button>
          </span>
          {!isDesktop ? (
            <button type="button" onClick={() => onNavigate('/')}>
              ← Вернуться на главную
            </button>
          ) : null}
        </div>
      </div>
    </Container>
  );
}

// B574: the site frame ships in this module, which main.tsx awaits before
// mounting an auth path, so no fallback frame is ever committed.
export { default as AuthSiteFrame } from './AuthSiteFrame';
