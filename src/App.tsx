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
import {
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
  WORKSPACE_OWNER_KEY,
  WORKSPACE_STORAGE_KEY,
  type CandidateWorkspace,
  type WorkspaceInput,
} from './features/workspace/workspaceStorage';

interface AppState {
  workspace?: CandidateWorkspace;
  invalidStorage: boolean;
  session?: AuthUser | null;
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/',
  );
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
    } catch {
      setSessionError(
        'Не удалось проверить аккаунт. Локальные карьерные данные скрыты до восстановления связи.',
      );
      setState({ invalidStorage: false });
    }
  }, []);

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
    persist(prepareCareerWorkspace(input, undefined, state.workspace));
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
  }

  // Routing checks
  if (isAdminPath(currentPath)) {
    return (
      <AppErrorBoundary>
        <AdminConsole session={state.session} sessionPending={state.session === undefined} />
      </AppErrorBoundary>
    );
  }

  if (currentPath === '/login') {
    return (
      <AppErrorBoundary>
        <LoginPage
          onNavigate={navigate}
          onSessionChange={handleSessionChange}
          nextPath="/app"
        />
      </AppErrorBoundary>
    );
  }

  if (currentPath === '/signup') {
    return (
      <AppErrorBoundary>
        <SignupPage
          onNavigate={navigate}
          onSessionChange={handleSessionChange}
          nextPath="/app"
        />
      </AppErrorBoundary>
    );
  }

  if (currentPath === '/reset-password') {
    return (
      <AppErrorBoundary>
        <ResetPasswordPage onNavigate={navigate} />
      </AppErrorBoundary>
    );
  }

  if (isAppPath(currentPath)) {
    return (
      <AppErrorBoundary>
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
          sessionPending={state.session === undefined}
          sessionError={sessionError}
          onRetrySession={() => void resolveSession()}
          onSessionChange={handleSessionChange}
        />
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

/** `/admin` and anything under it belong to the administrator console. */
function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

/** `/app` and anything under it belong to the authenticated candidate workspace. */
function isAppPath(path: string): boolean {
  return path === '/app' || path.startsWith('/app/');
}
