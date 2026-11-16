import { useState } from 'react';
import { SignOut } from '@phosphor-icons/react';
import { logout, type AuthUser } from '../coach/coachApi';

export interface CabinetB640Props {
  readonly session: AuthUser;
  readonly onSessionChange: (session: AuthUser | null) => void;
}

const SIGN_OUT_FAILED = 'Не удалось выйти. Попробуйте ещё раз.';

/**
 * B649: корень нового кабинета B640. Открывается только аккаунту с флагом
 * `features.cabinetB640`; оболочка и разделы подключаются следующим шагом.
 */
export function CabinetB640({ session, onSessionChange }: CabinetB640Props) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await logout();
      onSessionChange(null);
    } catch {
      setError(SIGN_OUT_FAILED);
      setSigningOut(false);
    }
  }

  return (
    <div className="b640" data-testid="cabinet-b640">
      <main className="b640-root-main">
        <h1 className="b640-root-title">{session.displayName ?? session.username}</h1>
        <button
          type="button"
          className="b640-root-action"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          aria-busy={signingOut}
        >
          <SignOut size={20} aria-hidden="true" />
          Выйти
        </button>
        {error ? (
          <p className="b640-root-error" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}
