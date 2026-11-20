import React, { useState } from 'react';
import { CoachApiError, completeTwoFactorLogin, type AuthUser } from '../coach/coachApi';
import { AuthInputField } from './AuthPageComponents';

interface TwoFactorLoginStepProps {
  readonly challenge: string;
  readonly onSignedIn: (user: AuthUser) => void;
  /** Вызов истёк или исчерпан: вход начинается заново с пароля. */
  readonly onRestart: (notice: string) => void;
}

/** B401: шаг «код из приложения» внутри экрана входа — только у кого включена защита. */
export function TwoFactorLoginStep({ challenge, onSignedIn, onRestart }: TwoFactorLoginStepProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return setError('Введите код');
    setBusy(true);
    setError(undefined);
    try {
      onSignedIn(await completeTwoFactorLogin(challenge, code));
    } catch (reason) {
      if (reason instanceof CoachApiError && reason.code === 'two_factor_challenge_expired') {
        onRestart(reason.message);
        return;
      }
      setError(reason instanceof CoachApiError ? reason.message : 'Не удалось войти. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error ? (
        <div className="career-cabinet-global-error auth-form-error" role="alert">
          {error}
        </div>
      ) : null}
      <form className="auth-form" method="post" action="#" onSubmit={(event) => void submit(event)}>
        <AuthInputField
          id="login-code"
          name="code"
          label="Код из приложения или резервный код"
          autoComplete="one-time-code"
          maxLength={11}
          value={code}
          onChange={setCode}
          disabled={busy}
          required
        />
        <button type="submit" className="site-btn is-primary auth-submit-btn" disabled={busy}>
          {busy ? 'Входим...' : 'Войти в кабинет'}
        </button>
      </form>
    </>
  );
}
