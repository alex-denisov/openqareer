import { useCallback, useEffect, useState } from 'react';
import { AdminConsole } from './features/admin/AdminConsole';
import { getSession, type AuthUser } from './features/coach/coachApi';
import {
  connectionResultMessage,
  readConnectionResult,
} from './features/connections/connectionResult';
import { prepareCareerWorkspace } from './features/journey/careerJourneyEngine';
import { CareerWorkspaceShell } from './features/shell/CareerWorkspaceShell';
import { AppErrorBoundary } from './features/shell/AppErrorBoundary';
import { LandingPage } from './features/site/LandingPage';
import { LoginPage, SignupPage, ResetPasswordPage } from './features/site/AuthPages';
import { isTauriEnvironment } from './services/desktop/desktopBridge';
import {
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
  WORKSPACE_OWNER_KEY,
  WORKSPACE_STORAGE_KEY,
  type CandidateWorkspace,
  type WorkspaceInput,
} from './features/workspace/workspaceStorage';
import { saveResumeStudioDraft } from './features/resume/resumeApi';
import { toSavePayload } from './features/resume/resumeStudioModel';

interface AppState {
  workspace?: CandidateWorkspace;
  invalidStorage: boolean;
  session?: AuthUser | null;
}

export default function App() {
  const [isDesktop] = useState(() => isTauriEnvironment());
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (isTauriEnvironment() && (path === '/' || path === '' || path === '/index.html')) {
        return '/login';
      }
      return path;
    }
    return '/';
  });
  const [state, setState] = useState<AppState>({ invalidStorage: false });
  const [storageError, setStorageError] = useState<string>();
  const [sessionError, setSessionError] = useState<string>();
  const [connectionNotice, setConnectionNotice] = useState<string>();

  const navigate = useCallback((path: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', path);
      setCurrentPath(path);
      window.scrollTo(0, 0);
    }
  }, []);

  const resolveSession = useCallback(async () => {
    setSessionError(undefined);
    try {
      const session = await getSession();
      const result = loadWorkspace(
        window.localStorage,
        session?.candidateId ?? null,
      );
      setState({
        session,
        workspace: result.status === 'ready' ? result.workspace : undefined,
        invalidStorage: result.status === 'invalid',
      });
      if (isDesktop && session?.candidateId && (currentPath === '/login' || currentPath === '/')) {
        navigate('/app');
      }
    } catch {
      setSessionError(
        'Не удалось проверить аккаунт. Локальные карьерные данные скрыты до восстановления связи.',
      );
      setState({ invalidStorage: false });
    }
  }, [currentPath, isDesktop, navigate]);

  useEffect(() => {
    document.getElementById('root')?.removeAttribute('aria-busy');
    void resolveSession();
  }, [resolveSession]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const result = readConnectionResult(window.location);
    if (!result) return;
    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage(
          { type: 'openqareer_oauth_complete', result },
          '*',
        );
        window.close();
        return;
      } catch {
        // Fall back to in-window navigation
      }
    }
    setConnectionNotice(connectionResultMessage(result));
    // The callback lands on a dedicated route; the candidate continues in the
    // canonical shell, so the one-time result is removed from the address bar.
    window.history.replaceState(null, '', '/app');
    setCurrentPath('/app');
  }, []);

  useEffect(() => {
    if (state.session === undefined) return;
    const handleStorage = (event: StorageEvent) => {
      if (
        event.storageArea !== window.localStorage ||
        (event.key !== WORKSPACE_STORAGE_KEY && event.key !== WORKSPACE_OWNER_KEY)
      ) {
        return;
      }
      const result = loadWorkspace(
        window.localStorage,
        state.session?.candidateId ?? null,
      );
      setState((current) => ({
        ...current,
        workspace: result.status === 'ready' ? result.workspace : undefined,
        invalidStorage: result.status === 'invalid',
      }));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [state.session]);

  function persist(workspace: CandidateWorkspace) {
    try {
      if (state.session?.candidateId) {
        saveWorkspace(
          window.localStorage,
          workspace,
          state.session.candidateId,
        );
      } else {
        clearWorkspace(window.localStorage);
      }
      setStorageError(undefined);
    } catch {
      setStorageError(
        'Браузер не разрешил сохранить изменения. Проверьте настройки локального хранения.',
      );
    }
    setState((current) => ({
      ...current,
      workspace,
      invalidStorage: false,
    }));
  }

  function handleSave(input: WorkspaceInput) {
    const workspace = prepareCareerWorkspace(input, undefined, state.workspace);
    persist(workspace);
    if (input.resumeDraft && state.session?.candidateId) {
      void saveResumeStudioDraft(toSavePayload(input.resumeDraft)).catch(() => {
        // Ignored; local workspace holds the parsed draft fallback
      });
    }
  }

  function handleClear() {
    try {
      clearWorkspace(window.localStorage);
      setStorageError(undefined);
      setState((current) => ({
        ...current,
        workspace: undefined,
        invalidStorage: false,
      }));
    } catch {
      setStorageError(
        'Браузер не разрешил удалить запись. Очистите данные сайта в настройках.',
      );
    }
  }

  function handleSessionChange(session: AuthUser | null) {
    const result = session?.candidateId
      ? loadWorkspace(window.localStorage, session.candidateId)
      : { status: 'empty' as const };
    setState({
      session,
      workspace: result.status === 'ready' ? result.workspace : undefined,
      invalidStorage: result.status === 'invalid',
    });
    setSessionError(undefined);
    if (session === null) {
      navigate(isDesktop ? '/login' : '/');
    }
  }

  const renderAuthContent = () => {
    if (currentPath === '/login') {
      return (
        <LoginPage
          onNavigate={navigate}
          onSessionChange={handleSessionChange}
          nextPath="/app"
        />
      );
    }
    if (currentPath === '/signup') {
      return (
        <SignupPage
          onNavigate={navigate}
          onSessionChange={handleSessionChange}
          nextPath="/app"
        />
      );
    }
    if (currentPath === '/reset-password') {
      return <ResetPasswordPage onNavigate={navigate} />;
    }
    return null;
  };

  const renderWorkspace = (sessionPending = state.session === undefined) => (
    <CareerWorkspaceShell
      workspace={state.workspace}
      invalidStorage={state.invalidStorage}
      storageError={storageError}
      connectionNotice={connectionNotice}
      onDismissConnectionNotice={() => setConnectionNotice(undefined)}
      onSaveWorkspace={handleSave}
      onUpdateWorkspace={persist}
      onClearWorkspace={handleClear}
      session={state.session}
      sessionPending={sessionPending}
      sessionError={sessionError}
      onRetrySession={() => void resolveSession()}
      onSessionChange={handleSessionChange}
    />
  );

  // Routing checks
  if (isAdminPath(currentPath)) {
    return (
      <AppErrorBoundary>
        <AdminConsole session={state.session} sessionPending={state.session === undefined} />
      </AppErrorBoundary>
    );
  }

  if (isAuthPath(currentPath)) {
    if (isDesktop) {
      return (
        <AppErrorBoundary>
          <div className="desktop-app-container" style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
            {renderWorkspace(true)}
            <div
              className="desktop-auth-overlay"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                background: 'rgba(9, 13, 18, 0.76)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                overflowY: 'auto',
              }}
            >
              {renderAuthContent()}
            </div>
          </div>
        </AppErrorBoundary>
      );
    }

    return (
      <AppErrorBoundary>
        {renderAuthContent()}
      </AppErrorBoundary>
    );
  }

  if (isAppPath(currentPath)) {
    return (
      <AppErrorBoundary>
        {renderWorkspace()}
      </AppErrorBoundary>
    );
  }

  // In desktop companion mode, landing page is never shown: show workspace if logged in or workspace with login gate
  if (isDesktop) {
    if (state.session?.candidateId) {
      return (
        <AppErrorBoundary>
          {renderWorkspace()}
        </AppErrorBoundary>
      );
    }
    return (
      <AppErrorBoundary>
        <div className="desktop-app-container" style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
          {renderWorkspace(true)}
          <div
            className="desktop-auth-overlay"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: 'rgba(9, 13, 18, 0.76)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              overflowY: 'auto',
            }}
          >
            <LoginPage
              onNavigate={navigate}
              onSessionChange={handleSessionChange}
              nextPath="/app"
            />
          </div>
        </div>
      </AppErrorBoundary>
    );
  }

  // Default: Public landing page at `/`
  return (
    <AppErrorBoundary>
      <LandingPage session={state.session} onNavigate={navigate} />
    </AppErrorBoundary>
  );
}

function isAuthPath(path: string): boolean {
  return path === '/login' || path === '/signup' || path === '/reset-password';
}

/** `/admin` and anything under it belong to the administrator console. */
function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

/** `/app` and anything under it belong to the authenticated candidate workspace. */
function isAppPath(path: string): boolean {
  if (typeof window !== 'undefined' && window.location.search.includes('render-shot')) {
    return true;
  }
  return path === '/app' || path.startsWith('/app/');
}
