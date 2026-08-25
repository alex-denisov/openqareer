import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  DownloadSimple,
  Key,
  ShieldCheck,
  SignOut,
  Trash,
  UserCircle,
  UserPlus,
  X,
} from '@phosphor-icons/react';
import {
  changePassword,
  CoachApiError,
  deleteCandidateAccount,
  exportCandidateData,
  getAccount,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  revokeOtherSessions,
  type AccountSnapshot,
  type AuthUser,
} from '../coach/coachApi';
import { AccountConnectionsManager } from '../connections/AccountConnections';
import {
  MIN_PASSWORD_LENGTH,
  getEmailError,
  getNameError,
  getPasswordError,
  sanitizeEmail,
  sanitizeName,
} from '../../../shared/accountValidation';

interface CareerAccountPanelProps {
  initialUser?: AuthUser | null;
  onClose: () => void;
  onIdentityChange: (session: AuthUser | null) => void;
}

type AuthMode = 'choose' | 'login' | 'register' | 'forgot' | 'reset';
type AccountSection = 'connections' | 'security' | 'data';

/**
 * The drawer holds account settings only. It used to also carry shortcuts into
 * «Resume Studio» and «Карьерный радар» — sections the left rail already owns —
 * which made it look like a second, competing navigation (B148 §10).
 */
const ACCOUNT_SECTION_LABELS: Record<AccountSection, string> = {
  connections: 'Подключения',
  security: 'Безопасность',
  data: 'Мои данные',
};

const ACCOUNT_SECTION_LEADS: Record<AccountSection, string> = {
  connections: 'Площадки, из которых OpenQareer читает ваш профиль и резюме.',
  security: 'Пароль и активные входы на других устройствах.',
  data: 'Выгрузка всего, что мы храним, и удаление аккаунта.',
};

export function CareerAccountPanel({
  initialUser,
  onClose,
  onIdentityChange,
}: CareerAccountPanelProps) {
  const resetToken = resetTokenFromLocation();
  const [user, setUser] = useState<AuthUser | null | undefined>(initialUser);
  const [account, setAccount] = useState<AccountSnapshot>();
  const [mode, setMode] = useState<AuthMode>(() => (resetToken ? 'reset' : 'choose'));
  const [section, setSection] = useState<AccountSection>('connections');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      returnFocusTo?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    if (!user) {
      setAccount(undefined);
      return;
    }
    let active = true;
    void getAccount()
      .then((value) => {
        if (!active) return;
        setAccount(value);
        setEmail(value.email ?? '');
        setDisplayName(value.displayName ?? '');
      })
      .catch((reason) => {
        if (active) setError(accountError(reason));
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);

    if (mode === 'register') {
      // Check every field at once so the candidate fixes one form, not one
      // field per round trip.
      const found: Record<string, string> = {};
      const name = getNameError(displayName);
      if (name) found.displayName = name;
      const address = getEmailError(email);
      if (address) found.email = address;
      const secret = getPasswordError(password);
      if (secret) found.password = secret;
      setFieldErrors(found);
      if (Object.keys(found).length > 0) return;
    } else {
      setFieldErrors({});
    }

    setBusy(true);
    try {
      const authenticated =
        mode === 'register'
          ? await register({
              email: email.trim(),
              displayName: displayName.trim(),
              password,
            })
          : await login(username.trim(), password);
      onIdentityChange(authenticated);
      setUser(authenticated);
      setMode('choose');
      setPassword('');
      setFieldErrors({});
      onClose();
    } catch (reason) {
      setError(accountError(reason));
      setFieldErrors(reason instanceof CoachApiError ? reason.fields : {});
    } finally {
      setBusy(false);
    }
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([name]) => name !== field),
      );
    });
  }

  async function submitResetRequest(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const deliveryConfigured = await requestPasswordReset(username);
      setNotice(
        deliveryConfigured
          ? 'Если аккаунт найден и для него указан email, письмо со ссылкой уже отправляется.'
          : 'Отправка писем пока не подключена. Доступ не изменён; восстановление станет доступно после настройки почтового домена.',
      );
    } catch (reason) {
      setError(accountError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: React.FormEvent) {
    event.preventDefault();
    if (!resetToken) return;
    setBusy(true);
    setError(undefined);
    try {
      const authenticated = await resetPassword(resetToken, newPassword);
      onIdentityChange(authenticated);
      setUser(authenticated);
      setNewPassword('');
      window.history.replaceState(null, '', '/');
      onClose();
    } catch (reason) {
      setError(accountError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const authenticated = await changePassword({
        currentPassword: stringValue(form, 'currentPassword'),
        newPassword: stringValue(form, 'newPassword'),
      });
      setUser(authenticated);
      onIdentityChange(authenticated);
      event.currentTarget.reset();
      setNotice('Пароль изменён. Остальные сессии завершены.');
    } catch (reason) {
      setError(accountError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function closeOtherSessions() {
    setBusy(true);
    setError(undefined);
    try {
      const revoked = await revokeOtherSessions();
      setNotice(`Завершено сессий: ${revoked}. Текущая сессия сохранена.`);
      setAccount(await getAccount());
    } catch (reason) {
      setError(accountError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport() {
    setBusy(true);
    setError(undefined);
    try {
      const exported = await exportCandidateData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'openqareer-candidate-export.json';
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Экспорт подготовлен и передан браузеру.');
    } catch (reason) {
      setError(accountError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const confirmation = stringValue(new FormData(event.currentTarget), 'confirmation');
    if (confirmation !== 'УДАЛИТЬ') {
      setError('Для удаления введите «УДАЛИТЬ» полностью.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await deleteCandidateAccount();
      onIdentityChange(null);
      setUser(null);
      onClose();
    } catch (reason) {
      setError(accountError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError(undefined);
    try {
      await logout();
      onIdentityChange(null);
      setUser(null);
      setMode('choose');
      onClose();
    } catch (reason) {
      setError(accountError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      ref={panel}
      className="career-account-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Аккаунт"
    >
      <header>
        <div>
          <span className="career-account-icon">
            <ShieldCheck size={20} />
          </span>
          <div>
            <strong>Аккаунт</strong>
            <small>
              {user
                ? 'Подключения, безопасность и ваши данные'
                : 'Защищённый карьерный профиль'}
            </small>
          </div>
        </div>
        <button
          ref={closeButton}
          type="button"
          className="career-account-close"
          onClick={onClose}
          aria-label="Закрыть аккаунт"
        >
          <X size={16} weight="bold" />
        </button>
      </header>

      <div className="career-account-body">
        {user === undefined ? <p>Проверяем сессию…</p> : null}
        {user ? (
          <AuthenticatedAccount
            user={user}
            account={account}
            section={section}
            busy={busy}
            onSectionChange={setSection}
            onSavePassword={savePassword}
            onCloseOtherSessions={closeOtherSessions}
            onDownloadExport={downloadExport}
            onDeleteAccount={deleteAccount}
            onSignOut={signOut}
          />
        ) : null}

        {user === null && mode === 'choose' ? (
          <div className="career-account-choices">
            <p>
              Войдите, чтобы диалог, документы и рыночные наблюдения принадлежали только вашему
              профилю.
            </p>
            <button
              className="career-primary-button"
              type="button"
              onClick={() => setMode('register')}
            >
              <UserPlus size={18} /> Создать аккаунт
            </button>
            <button className="career-quiet-button" type="button" onClick={() => setMode('login')}>
              Войти <ArrowRight size={17} />
            </button>
            <button
              className="career-account-text-button"
              type="button"
              onClick={() => setMode('forgot')}
            >
              Не помню пароль
            </button>
          </div>
        ) : null}

        {user === null && (mode === 'login' || mode === 'register') ? (
          <form className="career-account-form" onSubmit={submitAuth}>
            <h2>{mode === 'register' ? 'Новый аккаунт' : 'Вход'}</h2>
            {mode === 'register' ? (
              <>
                <AuthField label="Как к вам обращаться" error={fieldErrors.displayName}>
                  <input
                    value={displayName}
                    onChange={(event) => {
                      setDisplayName(sanitizeName(event.target.value));
                      clearFieldError('displayName');
                    }}
                    placeholder="Например, Мария"
                    autoComplete="given-name"
                    aria-invalid={fieldErrors.displayName ? true : undefined}
                  />
                </AuthField>
                <AuthField label="Email" error={fieldErrors.email}>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(sanitizeEmail(event.target.value));
                      clearFieldError('email');
                    }}
                    placeholder="you@example.com"
                    autoComplete="email"
                    aria-invalid={fieldErrors.email ? true : undefined}
                  />
                </AuthField>
              </>
            ) : (
              <AuthField label="Email или логин" error={fieldErrors.username}>
                <input
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    clearFieldError('username');
                  }}
                  autoComplete="username"
                  maxLength={254}
                  required
                />
              </AuthField>
            )}
            <AuthField
              label="Пароль"
              error={fieldErrors.password}
              hint={
                mode === 'register' ? `Не короче ${MIN_PASSWORD_LENGTH} символов` : undefined
              }
            >
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFieldError('password');
                }}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                maxLength={256}
                aria-invalid={fieldErrors.password ? true : undefined}
                required={mode === 'login'}
              />
            </AuthField>
            <button className="career-primary-button" disabled={busy}>
              {busy ? 'Сохраняем…' : mode === 'register' ? 'Создать и начать' : 'Войти'}
            </button>
            {mode === 'login' ? (
              <button
                className="career-account-text-button"
                type="button"
                onClick={() => setMode('forgot')}
              >
                Восстановить пароль
              </button>
            ) : null}
            <button className="career-quiet-button" type="button" onClick={() => setMode('choose')}>
              Назад
            </button>
          </form>
        ) : null}

        {user === null && mode === 'forgot' ? (
          <form className="career-account-form" onSubmit={submitResetRequest}>
            <Key size={24} />
            <h2>Восстановление пароля</h2>
            <p>Укажите логин или email. Ответ одинаковый независимо от того, найден ли аккаунт.</p>
            <label>
              <span>Логин или email</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                minLength={3}
                maxLength={254}
                required
              />
            </label>
            <button className="career-primary-button" disabled={busy}>
              {busy ? 'Отправляем…' : 'Отправить ссылку'}
            </button>
            <button className="career-quiet-button" type="button" onClick={() => setMode('choose')}>
              Назад
            </button>
          </form>
        ) : null}

        {user === null && mode === 'reset' ? (
          <form className="career-account-form" onSubmit={submitReset}>
            <Key size={24} />
            <h2>Новый пароль</h2>
            <label>
              <span>Пароль не короче {MIN_PASSWORD_LENGTH} символов</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={256}
                required
              />
            </label>
            <button className="career-primary-button" disabled={busy || !resetToken}>
              {busy ? 'Сохраняем…' : 'Задать новый пароль'}
            </button>
          </form>
        ) : null}

        {notice ? (
          <p className="career-account-success" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="career-expert-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function AuthenticatedAccount({
  user,
  account,
  section,
  busy,
  onSectionChange,
  onSavePassword,
  onCloseOtherSessions,
  onDownloadExport,
  onDeleteAccount,
  onSignOut,
}: {
  user: AuthUser;
  account?: AccountSnapshot;
  section: AccountSection;
  busy: boolean;
  onSectionChange: (section: AccountSection) => void;
  onSavePassword: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onCloseOtherSessions: () => Promise<void>;
  onDownloadExport: () => Promise<void>;
  onDeleteAccount: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  return (
    <>
      <div className="career-account-current">
        <span className="career-account-avatar">
          <UserCircle size={22} />
        </span>
        <div>
          <span>Вы вошли как</span>
          <strong>{account?.displayName ?? user.displayName ?? user.username}</strong>
          <small>{account?.email ?? user.email ?? user.username}</small>
        </div>
      </div>

      <nav className="career-account-tabs" aria-label="Настройки аккаунта">
        {(['connections', 'security', 'data'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={section === item ? 'is-active' : ''}
            aria-current={section === item ? 'page' : undefined}
            onClick={() => onSectionChange(item)}
          >
            {ACCOUNT_SECTION_LABELS[item]}
          </button>
        ))}
      </nav>
      <p className="career-account-section-lead">
        {ACCOUNT_SECTION_LEADS[section]}
      </p>

      {section === 'connections' ? <AccountConnectionsManager /> : null}

      {section === 'security' ? (
        <div className="career-account-section-stack">
          <form className="career-account-form" onSubmit={onSavePassword}>
            <h2>Сменить пароль</h2>
            <label>
              <span>Текущий пароль</span>
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              <span>Новый пароль</span>
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={256}
                required
              />
            </label>
            <button className="career-primary-button" disabled={busy}>
              Изменить пароль
            </button>
          </form>
          <div className="career-account-session-card">
            <strong>{account?.sessions.length ?? 1} активных сессий</strong>
            <p>Завершите входы на других устройствах, если не узнаёте активность.</p>
            <button type="button" disabled={busy} onClick={() => void onCloseOtherSessions()}>
              Завершить остальные сессии
            </button>
          </div>
        </div>
      ) : null}

      {section === 'data' ? (
        <div className="career-account-section-stack">
          <section className="career-account-data-card">
            <DownloadSimple size={21} />
            <div>
              <strong>Экспорт данных</strong>
              <p>Скачайте профиль, память, документы и рыночные направления в JSON.</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void onDownloadExport()}>
              Скачать
            </button>
          </section>
          <form className="career-account-delete-form" onSubmit={onDeleteAccount}>
            <Trash size={21} />
            <div>
              <strong>Удалить аккаунт и данные</strong>
              <p>
                Это удалит профиль, историю диалога, документы и сохранённые поиски без возможности
                восстановления.
              </p>
            </div>
            <label>
              <span>Введите УДАЛИТЬ</span>
              <input name="confirmation" autoComplete="off" />
            </label>
            <button className="career-danger-button" disabled={busy}>
              Удалить навсегда
            </button>
          </form>
        </div>
      ) : null}

      <button
        className="career-account-signout"
        type="button"
        disabled={busy}
        onClick={() => void onSignOut()}
      >
        <SignOut size={18} /> Выйти
      </button>
    </>
  );
}

function resetTokenFromLocation() {
  if (typeof window === 'undefined' || window.location.pathname !== '/auth/reset-password') {
    return null;
  }
  return new URLSearchParams(window.location.search).get('token');
}

function stringValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function accountError(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) return reason.message;
  return 'Не удалось изменить аккаунт. Попробуйте ещё раз.';
}

/**
 * One labelled field with its own error line. Keeping the message next to the
 * input is the whole point of B139: a rejected form must say which field to
 * fix, not print one shared sentence at the bottom.
 */
function AuthField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={error ? 'career-account-field has-error' : 'career-account-field'}>
      <span>{label}</span>
      {children}
      {error ? (
        <small className="career-account-field-error" role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="career-account-field-hint">{hint}</small>
      ) : null}
    </label>
  );
}
