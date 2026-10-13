import { useEffect, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { LoginPage, SignupPage, type AuthPageProps } from '../site/AuthPages';
import { ResetPasswordPage } from '../site/PasswordResetPage';
import { EmailVerificationPage } from '../site/EmailVerificationPage';
import type { AuthUser } from '../coach/coachApi';

type AccountAccessView = 'login' | 'signup' | 'reset' | 'verify';

interface CareerAccountAccessProps {
  readonly session?: AuthUser | null;
  readonly onIdentityChange: (session: AuthUser | null) => void;
  readonly onClose: () => void;
}

export function CareerAccountAccess({
  session,
  onIdentityChange,
  onClose,
}: CareerAccountAccessProps) {
  const [currentSession, setCurrentSession] = useState<AuthUser | null>(session ?? null);
  const [view, setView] = useState<AccountAccessView>(
    session?.emailVerified === false ? 'verify' : 'login',
  );

  useEffect(() => {
    setCurrentSession(session ?? null);
    if (session?.emailVerified === false) setView('verify');
  }, [session]);

  const onSessionChange: AuthPageProps['onSessionChange'] = (nextSession) => {
    setCurrentSession(nextSession);
    onIdentityChange(nextSession ?? null);
  };

  const onNavigate: AuthPageProps['onNavigate'] = (path) => {
    if (path === '/signup') setView('signup');
    else if (path === '/verify-email') setView('verify');
    else if (path === '/reset-password') setView('reset');
    else if (path === '/login') setView('login');
  };

  return (
    <section className="career-account-access" aria-labelledby="account-access-title">
      <div className="career-account-access-header">
        <h1 id="account-access-title">Аккаунт</h1>
        <button type="button" className="career-btn is-ghost is-sm" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden="true" />
          Назад
        </button>
      </div>
      {view === 'signup' ? (
        <SignupPage onNavigate={onNavigate} onSessionChange={onSessionChange} nextPath="/app" />
      ) : view === 'reset' ? (
        <ResetPasswordPage onNavigate={onNavigate} onSessionChange={onSessionChange} nextPath="/app" />
      ) : view === 'verify' ? (
        <EmailVerificationPage
          session={currentSession}
          onNavigate={onNavigate}
          onSessionChange={onSessionChange}
          nextPath="/app"
        />
      ) : (
        <LoginPage onNavigate={onNavigate} onSessionChange={onSessionChange} nextPath="/app" />
      )}
    </section>
  );
}
