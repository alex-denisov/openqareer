import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ShieldCheck, SignOut, UserPlus, X } from '@phosphor-icons/react';
import {
  CoachApiError,
  login,
  logout,
  register,
  type AuthUser,
} from '../coach/coachApi';
import { AccountConnectionsManager } from '../connections/AccountConnections';

interface CareerAccountPanelProps {
  initialUser?: AuthUser | null;
  onClose: () => void;
  onIdentityChange: (session: AuthUser | null) => void;
}

type AuthMode = 'choose' | 'login' | 'register';

export function CareerAccountPanel({
  initialUser,
  onClose,
  onIdentityChange,
}: CareerAccountPanelProps) {
  const [user, setUser] = useState<AuthUser | null | undefined>(initialUser);
  const [mode, setMode] = useState<AuthMode>('choose');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const authenticated =
        mode === 'register'
          ? await register(username, password)
          : await login(username, password);
      onIdentityChange(authenticated);
      setUser(authenticated);
      setMode('choose');
      setPassword('');
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
    <aside ref={panel} className="career-account-panel" role="dialog" aria-modal="true" aria-label="Аккаунт">
      <header>
        <div>
          <span className="career-account-icon"><ShieldCheck size={20} /></span>
          <div><strong>Аккаунт</strong><small>Личные данные и новый старт</small></div>
        </div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть аккаунт">
          <X size={20} />
        </button>
      </header>

      <div className="career-account-body">
        {user === undefined ? <p>Проверяем сессию…</p> : null}
        {user ? (
          <>
            <div className="career-account-current">
              <span>Вы вошли как</span>
              <strong>{user.username}</strong>
              <small>{user.isTest ? 'Тестовый кандидат' : 'Личный аккаунт кандидата'}</small>
            </div>
            <AccountConnectionsManager />
            <button className="career-danger-button" type="button" disabled={busy} onClick={signOut}>
              <SignOut size={18} />
              {busy ? 'Выходим…' : 'Выйти и начать заново'}
            </button>
            <p className="career-account-note">
              Сессия завершится, а данные этого рабочего пространства будут удалены из браузера.
            </p>
          </>
        ) : null}

        {user === null && mode === 'choose' ? (
          <div className="career-account-choices">
            <p>Войдите в существующий аккаунт или создайте отдельный чистый профиль для проверки первого пути.</p>
            <button className="career-primary-button" type="button" onClick={() => setMode('register')}>
              <UserPlus size={18} /> Создать новый аккаунт
            </button>
            <button className="career-quiet-button" type="button" onClick={() => setMode('login')}>
              Войти <ArrowRight size={17} />
            </button>
          </div>
        ) : null}

        {user === null && mode !== 'choose' ? (
          <form className="career-account-form" onSubmit={submit}>
            <h2>{mode === 'register' ? 'Новый аккаунт' : 'Вход'}</h2>
            <label>
              <span>Логин</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={80} required />
            </label>
            <label>
              <span>Пароль</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : 1} required />
            </label>
            <button className="career-primary-button" disabled={busy}>
              {busy ? 'Сохраняем…' : mode === 'register' ? 'Создать и начать' : 'Войти'}
            </button>
            <button className="career-quiet-button" type="button" onClick={() => setMode('choose')}>Назад</button>
          </form>
        ) : null}
        {error ? <p className="career-expert-error" role="alert">{error}</p> : null}
      </div>
    </aside>
  );
}

function accountError(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) return reason.message;
  return 'Не удалось изменить аккаунт. Попробуйте ещё раз.';
}
