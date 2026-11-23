import { useEffect, useState } from 'react';
import type { AuthUser } from '../coach/coachApi';
import { AuthCardHeader } from './AuthPageComponents';
import {
  appCallbackUrl,
  appSignInLoginPath,
  readAppSignInRequest,
  requestAppCode,
  type AppSignInRequest,
} from './appSignIn';

interface AppSignInPageProps {
  readonly session: AuthUser | null | undefined;
  readonly onNavigate: (path: string) => void;
  /** Уход на `openqareer://…`; в тестах подменяется. */
  readonly openCallback?: (url: string) => void;
}

const openInPlace = (url: string) => window.location.assign(url);

/**
 * B755: «Войти в приложение openqareer на этом Mac». Код уходит в приложение только по
 * нажатию «Войти», даже если вход на сайте уже выполнен (решение оркестратора, 23.11).
 */
export function AppSignInPage({
  session,
  onNavigate,
  openCallback = openInPlace,
}: AppSignInPageProps) {
  const request = readAppSignInRequest(window.location.search);
  // Адрес возврата с кодом живёт только здесь: ни в тексте, ни в ссылках страницы его нет.
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (request && session === null) onNavigate(appSignInLoginPath(request));
  }, [request, session, onNavigate]);

  if (!request) {
    return <AppSignInCard onNavigate={onNavigate} subtitle="Начните вход в приложении заново." />;
  }
  if (!session) return <AppSignInCard onNavigate={onNavigate} busy />;
  if (sent) {
    return (
      <AppSignInCard onNavigate={onNavigate} subtitle="Можно вернуться в приложение.">
        <div className="auth-form">
          <button
            type="button"
            className="site-btn is-primary auth-submit-btn"
            onClick={() => openCallback(sent)}
          >
            Открыть приложение
          </button>
        </div>
      </AppSignInCard>
    );
  }
  return (
    <ChoiceCard
      request={request}
      session={session}
      onNavigate={onNavigate}
      onBack={(url) => {
        setSent(url);
        openCallback(url);
      }}
    />
  );
}

interface ChoiceCardProps {
  readonly request: AppSignInRequest;
  readonly session: AuthUser;
  readonly onNavigate: (path: string) => void;
  readonly onBack: (url: string) => void;
}

/** «Войти» / «Отмена»: код просим только по нажатию. */
function ChoiceCard({ request, session, onNavigate, onBack }: ChoiceCardProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const signIn = async () => {
    setBusy(true);
    setFailed(false);
    try {
      onBack(appCallbackUrl(request, { code: await requestAppCode(request.challenge) }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppSignInCard
      onNavigate={onNavigate}
      subtitle={`Аккаунт ${session.email ?? session.username}`}
    >
      <div className="auth-form">
        {failed ? (
          <p className="auth-field-error" role="alert">
            Не удалось войти. Начните вход в приложении заново.
          </p>
        ) : null}
        <button
          type="button"
          className="site-btn is-primary auth-submit-btn"
          disabled={busy}
          onClick={() => void signIn()}
        >
          Войти
        </button>
        <button
          type="button"
          className="site-btn is-secondary auth-submit-btn"
          disabled={busy}
          onClick={() => onBack(appCallbackUrl(request, 'cancel'))}
        >
          Отмена
        </button>
      </div>
    </AppSignInCard>
  );
}

function AppSignInCard({
  onNavigate,
  subtitle,
  busy = false,
  children,
}: {
  readonly onNavigate: (path: string) => void;
  readonly subtitle?: string;
  readonly busy?: boolean;
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="auth-page-container" aria-busy={busy}>
      <div className="auth-card">
        <AuthCardHeader
          title="Войти в приложение openqareer на этом Mac"
          subtitle={subtitle}
          onNavigate={onNavigate}
        />
        {children}
      </div>
    </div>
  );
}
