import { useCallback, useEffect, useState } from 'react';
import { AdminConsole } from './features/admin/AdminConsole';
import {
  getCandidateWorkspace,
  getSession,
  putCandidateWorkspace,
  type AuthUser,
} from './features/coach/coachApi';
import { resolveCandidateWorkspace } from './features/workspace/workspaceHydration';
import { prepareCareerWorkspace } from './features/journey/careerJourneyEngine';
import { CareerWorkspaceShell } from './features/shell/CareerWorkspaceShell';
import { AppErrorBoundary } from './features/shell/AppErrorBoundary';
import { LandingPage } from './features/site/LandingPage';
import { LegalDocumentPage } from './features/legal/LegalDocumentPage';
import { legalSlugFromPath } from '../shared/legalRegistry';
import { LoginPage, SignupPage, ResetPasswordPage } from './features/site/AuthPages';
import { resolvedDesktopSessionPath } from './features/site/desktopSessionRouting';
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
import {
  importCandidateResume,
  type ResumeImportSource,
} from './features/resume/resumeApi';

function importSourceOf(source: WorkspaceInput['resumeSource']): ResumeImportSource {
  if (source === 'linkedin-pdf') return 'linkedin';
  if (source === 'hh-pdf') return 'hh';
  if (source === 'pdf') return 'pdf';
  return 'text';
}

interface AppState {
  workspace?: CandidateWorkspace;
  invalidStorage: boolean;
  session?: AuthUser | null;
}

export default function App() {
  const [isDesktop] = useState(() => isTauriEnvironment());
  const [isResolvingSession, setIsResolvingSession] = useState(true);
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (isTauriEnvironment() && (path === '/' || path === '' || path === '/index.html')) {
        return '/app';
      }
      return path;
    }
    return '/';
  });
  const [state, setState] = useState<AppState>({ invalidStorage: false });
  const [storageError, setStorageError] = useState<string>();
  const [sessionError, setSessionError] = useState<string>();
  const SESSION_CHECK_TIMEOUT_MS = 8_000;

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
      const session = await getSession(AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS));
      const result = loadWorkspace(
        window.localStorage,
        session?.candidateId ?? null,
      );
      // Browser storage is a cache. Sign-out clears it and a different browser
      // never had it, so a signed-in candidate whose cache is empty is read
      // back from the server instead of being treated as brand new with every
      // section locked (INC-024).
      const remote =
        session?.candidateId && result.status !== 'ready'
          ? await getCandidateWorkspace().catch(() => null)
          : null;
      const workspace = resolveCandidateWorkspace({ local: result, remote });
      setState({
        session,
        workspace,
        invalidStorage: result.status === 'invalid' && !workspace,
      });
      if (isDesktop) {
        const resolvedPath = resolvedDesktopSessionPath(currentPath, Boolean(session?.candidateId));
        if (resolvedPath) navigate(resolvedPath);
      }
    } catch {
      setSessionError(
        'Не удалось проверить аккаунт. Локальные карьерные данные скрыты до восстановления связи.',
      );
      setState({ invalidStorage: false });
    } finally {
      setIsResolvingSession(false);
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
        // Write through, so the answers survive this browser.
        void putCandidateWorkspace(workspaceInputOf(workspace)).catch(() => {
          setStorageError(
            'Ответы сохранены в этом браузере, но не на сервере. Они могут не открыться на другом устройстве.',
          );
        });
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

  /**
   * Returns a promise while the import is still running, so the shell knows
   * when the cabinet may finally read a server that holds the facts. Without
   * it the cabinet's single reading raced the import and always lost
   * (INC-024).
   */
  function handleSave(input: WorkspaceInput): void | Promise<void> {
    const workspace = prepareCareerWorkspace(input, undefined, state.workspace);
    persist(workspace);
    // The wizard imports as soon as it reads a document; this is the retry for
    // the case where the candidate registered only after uploading. A failure
    // is shown, never swallowed — a silent 422 is what left Resume Studio empty
    // after a successful-looking import (B148 §3b).
    if (
      input.resumeText.trim().length === 0 ||
      input.resumeImported === true ||
      !state.session?.candidateId
    ) {
      return undefined;
    }
    return importCandidateResume({
      text: input.resumeText,
      source: importSourceOf(input.resumeSource),
      fileName: input.resumeFileName,
    })
      .then(() => undefined)
      .catch((reason: unknown) => {
        setStorageError(
          reason instanceof Error
            ? `Резюме не удалось сохранить в профиль: ${reason.message}`
            : 'Резюме не удалось сохранить в профиль. Откройте «Резюме» и повторите импорт.',
        );
      });
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
      onSaveWorkspace={handleSave}
      onUpdateWorkspace={persist}
      onClearWorkspace={handleClear}
      session={state.session}
      sessionPending={sessionPending}
      sessionError={sessionError}
      onRetrySession={() => void resolveSession()}
      onOpenLogin={() => navigate('/login')}
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
      if (isResolvingSession) {
        return (
          <AppErrorBoundary>
            {renderWorkspace(true)}
          </AppErrorBoundary>
        );
      }
      return (
        <AppErrorBoundary>
          <div className="desktop-app-container">
            {renderWorkspace(true)}
            <div className="desktop-auth-overlay">
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

  const legalSlug = legalSlugFromPath(currentPath);
  if (legalSlug && !isDesktop) {
    return (
      <AppErrorBoundary>
        <LegalDocumentPage slug={legalSlug} onNavigate={navigate} />
      </AppErrorBoundary>
    );
  }

  if (isAppPath(currentPath)) {
    return (
      <AppErrorBoundary>
        {renderWorkspace(isResolvingSession || state.session === undefined)}
      </AppErrorBoundary>
    );
  }

  // In desktop companion mode, landing page is never shown: show workspace if logged in or workspace with login gate
  if (isDesktop) {
    if (isResolvingSession || state.session?.candidateId) {
      return (
        <AppErrorBoundary>
          {renderWorkspace(isResolvingSession || state.session === undefined)}
        </AppErrorBoundary>
      );
    }
    return (
      <AppErrorBoundary>
        <div className="desktop-app-container">
          {renderWorkspace(true)}
          <div className="desktop-auth-overlay">
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

export function isAuthPath(path: string): boolean {
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

/**
 * Only the candidate's own answers travel to the server; the derived analysis
 * is rebuilt from them and the dossier, so storing it twice would let the two
 * copies disagree.
 */
function workspaceInputOf(workspace: CandidateWorkspace): WorkspaceInput {
  return {
    careerGoal: workspace.careerGoal,
    resumeText: workspace.resumeText,
    resumeSource: workspace.resumeSource,
    resumeFileName: workspace.resumeFileName,
    resumePageCount: workspace.resumePageCount,
    targetDirection: workspace.targetDirection,
    regions: workspace.regions,
    currentSituation: workspace.currentSituation,
    constraints: workspace.constraints,
    urgency: workspace.urgency,
    linkedinUrl: workspace.linkedinUrl,
    hhUrl: workspace.hhUrl,
    resumeImported: workspace.resumeImported,
  };
}
