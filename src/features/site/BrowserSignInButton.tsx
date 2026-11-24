import { useState } from 'react';
import { Globe } from '@phosphor-icons/react';
import type { AuthUser } from '../coach/coachApi';
import { canSignInThroughBrowser, signInThroughBrowser } from './desktopBrowserSignIn';

interface BrowserSignInButtonProps {
  readonly disabled?: boolean;
  readonly onSignedIn: (user: AuthUser) => void;
  /** Подменяется в тестах. */
  readonly signIn?: () => Promise<AuthUser | null>;
  readonly available?: boolean;
}

/** B755: в приложении на Mac — вход через браузер, как на сайте (пароль, 2FA или ключ). */
export function BrowserSignInButton({
  disabled = false,
  onSignedIn,
  signIn = signInThroughBrowser,
  available = canSignInThroughBrowser(),
}: BrowserSignInButtonProps) {
  const [failed, setFailed] = useState(false);
  if (!available) return null;

  const start = async () => {
    setFailed(false);
    try {
      const user = await signIn();
      if (user) onSignedIn(user);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="auth-form">
      {failed ? (
        <p className="auth-field-error" role="alert">
          Не удалось войти. Попробуйте ещё раз.
        </p>
      ) : null}
      <button
        type="button"
        className="site-btn is-secondary auth-submit-btn"
        disabled={disabled}
        onClick={() => void start()}
      >
        <Globe aria-hidden="true" size={18} />
        Войти через браузер
      </button>
    </div>
  );
}
