import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser, CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { CareerCabinet, type CareerCabinetView } from '../cabinet/CareerCabinet';
import { CareerExpertPanel } from '../journey/CareerExpertPanel';
import { OnboardingWizard } from '../journey/OnboardingWizard';
import {
  CareerMapView,
  OpportunitiesView,
  ProfileJourneyView,
  TodayJourneyView,
} from '../journey/CareerJourneyViews';
import { buildCareerJourney } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace, WorkspaceInput } from '../workspace/workspaceStorage';
import { CareerTariffsView } from './CareerTariffsView';
import { CURRENT_PLAN } from './tariffPackages';
import { createIntakeCompletion } from './intakeCompletion';
import { CareerAccountPanel, type AccountSection } from './CareerAccountPanel';
import { AppErrorBoundary } from './AppErrorBoundary';
import { CareerPathIndicator } from './CareerPathIndicator';
import { buildPathIndicator, type NavigationOptions } from './pathIndicator';
import { keepsIntakeAcrossIdentityChange, shouldShowIntake } from './intakeContinuity';
import { isSectionNavigable, sectionLockReason, type ShellSection } from './shellNavigation';
import {
  CareerMobileNavigation,
  CareerMobileTopbar,
  CareerNavigationRail,
} from './CareerShellNavigation';
import { CareerTodaySkeleton } from './CareerTodaySkeleton';

type ShellView = ShellSection;

interface CareerWorkspaceShellProps {
  workspace?: CandidateWorkspace;
  invalidStorage?: boolean;
  storageError?: string;
  onSaveWorkspace?: (input: WorkspaceInput) => void | Promise<void>;
  onUpdateWorkspace?: (workspace: CandidateWorkspace) => void;
  onClearWorkspace?: () => void;
  session?: AuthUser | null;
  sessionPending?: boolean;
  sessionError?: string;
  onRetrySession?: () => void;
  onOpenLogin?: () => void;
  onSessionChange?: (session: AuthUser | null) => void;
  /** Deep-links the shell straight to a section, e.g. a «Тарифы» link. */
  initialView?: ShellView;
}

/**
 * «Резюме» has no rail item in the B248 mockup either; the master resume
 * stays reachable from «Портфолио» on «Сегодня» (B179).
 */
const pageNames: Record<ShellView, string> = {
  today: 'Сегодня',
  profile: 'Профиль',
  resume: 'Резюме',
  career: 'Поиск',
  opportunities: 'Вакансии',
  responses: 'Отклики',
  tariffs: 'Тарифы',
};

const SESSION_GATE_DELAY_MS = 4_000;

export function CareerWorkspaceShell({
  workspace,
  invalidStorage = false,
  storageError,
  onSaveWorkspace = () => undefined,
  onUpdateWorkspace = () => undefined,
  onClearWorkspace = () => undefined,
  session,
  sessionPending = false,
  sessionError,
  onRetrySession = () => undefined,
  onOpenLogin = () => undefined,
  onSessionChange = () => undefined,
  initialView = 'today',
}: CareerWorkspaceShellProps) {
  const [activeView, setActiveView] = useState<ShellView>(initialView);
  const [expertConfig, setExpertConfig] = useState<{
    open: boolean;
    stage: CoachTurnStage;
    subject?: CoachTurnSubject;
    subjectTitle?: string;
  }>({
    open: sessionPending,
    stage: 'today',
  });
  const [expertSheetExpanded, setExpertSheetExpanded] = useState(false);
  const autoOpenedExpert = useRef(sessionPending);
  const [cabinetRevision, setCabinetRevision] = useState(0);
  const [accountOpen, setAccountOpen] = useState(
    () => typeof window !== 'undefined' && window.location.pathname === '/auth/reset-password',
  );
  const [accountSection, setAccountSection] = useState<AccountSection>('security');
  const [sessionWaitIsLong, setSessionWaitIsLong] = useState(false);
  // A diagnostic that is under way owns the «Сегодня» screen even after the
  // account its own source step demanded arrives (B141).
  const [intakeStarted, setIntakeStarted] = useState(false);
  // Identity, not the candidate id, decides when the wizard is thrown away: the
  // seed changes on every identity change except the registration the wizard
  // itself asked for, so answers never travel between candidates.
  const [intakeSeed, setIntakeSeed] = useState(0);
  // The wizard's import keeps running after the cabinet mounts; «Сегодня» must
  // not print a confident zero over it (B160 §3).
  const [, setImporting] = useState(false);
  const visibleWorkspace = sessionPending ? undefined : workspace;
  const cabinetSession =
    !sessionPending && session?.candidateId
      ? { ...session, candidateId: session.candidateId }
      : undefined;
  const canUseWorkspaceViews = Boolean(visibleWorkspace || cabinetSession);
  const journey = useMemo(
    () => (visibleWorkspace ? buildCareerJourney(visibleWorkspace) : undefined),
    [visibleWorkspace],
  );

  // Resume Studio reads and writes a candidate-scoped API, so a browser-local
  // workspace without an account has nothing to show and must not pretend to.
  const resumeAvailable = Boolean(cabinetSession);

  // The wizard owns the screen until it produces a workspace, so "the picture
  // exists" and "the wizard is done" are the same fact.
  const careerPictureReady = Boolean(visibleWorkspace);

  const intakeVisible = shouldShowIntake({
    sessionPending,
    hasWorkspace: Boolean(visibleWorkspace),
    hasCabinetSession: Boolean(cabinetSession),
    intakeStarted,
    isTodayView: activeView === 'today',
  });

  useEffect(() => {
    if (autoOpenedExpert.current || intakeVisible || !session?.candidateId || visibleWorkspace) return;
    autoOpenedExpert.current = true;
    setExpertConfig((current) => ({ ...current, open: true }));
  }, [intakeVisible, session?.candidateId, visibleWorkspace]);

  // onboarding.html is full-screen from its first step (owner decision
  // 2026-09-24, replacing the B141 exception that kept the rail on step 1 for
  // its account door); an anonymous candidate signs in from the wizard's own
  // top bar instead.
  const onboardingIsFullscreen = intakeVisible;
  const expertPanelOpen = expertConfig.open && !accountOpen && !onboardingIsFullscreen;

  useEffect(() => {
    if (!sessionPending) {
      setSessionWaitIsLong(false);
      return;
    }
    const timer = window.setTimeout(() => setSessionWaitIsLong(true), SESSION_GATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [sessionPending]);

  // The page name lives in the navigation and in the tab title; repeating it in
  // the top bar only duplicated the active item.
  useEffect(() => {
    document.title = `${pageNames[activeView]} · openqareer`;
  }, [activeView]);

  const navigationState = {
    careerPictureReady,
    resumeAvailable,
    canUseWorkspaceViews,
  };

  function isNavigable(view: ShellView) {
    return isSectionNavigable(view, navigationState);
  }

  function lockedReason(view: ShellView): string {
    return sectionLockReason(view, navigationState);
  }

  const [navigationOptions, setNavigationOptions] = useState<NavigationOptions | undefined>();

  function navigate(view: ShellView, options?: NavigationOptions) {
    const target = view === 'career' ? 'opportunities' : view;
    const targetOptions = view === 'career' ? { ...options, focusRoleFilter: true } : options;
    if (!isNavigable(target)) return;
    setActiveView(target);
    setNavigationOptions(targetOptions);
    setExpertConfig((prev) => ({ ...prev, open: false }));
    setExpertSheetExpanded(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('career-main')?.scrollTo({
        top: 0,
        behavior: 'auto',
      });
    });
  }

  useEffect(() => {
    if (activeView === 'career') {
      setActiveView('opportunities');
      setNavigationOptions({ focusRoleFilter: true });
    }
  }, [activeView]);

  const openExpert = useCallback(
    (stage?: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => {
      setExpertSheetExpanded(false);
      setExpertConfig({
        open: true,
        stage: stage ?? 'today',
        subject,
        subjectTitle,
      });
    },
    [],
  );

  const closeExpert = useCallback(() => {
    setExpertSheetExpanded(false);
    setExpertConfig((prev) => ({ ...prev, open: false }));
  }, []);

  useEffect(() => {
    if (onboardingIsFullscreen && expertConfig.open) closeExpert();
  }, [closeExpert, expertConfig.open, onboardingIsFullscreen]);

  const handleExpertEscape = useCallback(() => {
    const onPhone = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 760px)').matches);
    if (onPhone && expertSheetExpanded) {
      setExpertSheetExpanded(false);
      return;
    }
    closeExpert();
  }, [closeExpert, expertSheetExpanded]);

  const closeAccount = useCallback(() => {
    setAccountOpen(false);
    setAccountSection('security');
  }, []);
  const openAccount = useCallback(() => {
    setExpertSheetExpanded(false);
    setExpertConfig((previous) => ({ ...previous, open: false }));
    setAccountOpen(true);
  }, []);
  const openConnections = useCallback(() => {
    setAccountSection('connections');
    openAccount();
  }, [openAccount]);
  const resetForAccount = useCallback(
    (nextSession: AuthUser | null) => {
      setActiveView('today');
      if (!keepsIntakeAcrossIdentityChange(session?.candidateId, nextSession?.candidateId)) {
        setIntakeStarted(false);
        setIntakeSeed((seed) => seed + 1);
      }
      if (nextSession === null) onClearWorkspace();
      else setCabinetRevision((revision) => revision + 1);
      onSessionChange(nextSession);
    },
    [onClearWorkspace, onSessionChange, session?.candidateId],
  );

  // A finished diagnostic hands the screen to the cabinet and leaves a clean
  // wizard behind, so clearing the workspace later starts from the first
  // question instead of from someone's half-filled answers. The cabinet is
  // re-read once the import behind the save has settled, because mounting it
  // is what issues its single server reading (INC-024).
  const completeIntake = useMemo(
    () =>
      createIntakeCompletion({
        save: onSaveWorkspace,
        closeIntake: () => {
          setIntakeStarted(false);
          setIntakeSeed((seed) => seed + 1);
        },
        refreshCabinet: () => setCabinetRevision((revision) => revision + 1),
        setImporting,
      }),
    [onSaveWorkspace],
  );

  const planName = CURRENT_PLAN.name;

  return (
    <div
      className={`career-shell ${expertPanelOpen ? 'expert-is-open' : ''} ${
        onboardingIsFullscreen ? 'career-shell--onboarding-fullscreen' : ''
      }`}
      data-testid="career-shell"
    >
      <a className="career-skip-link" href="#career-main">
        К содержанию
      </a>

      <CareerNavigationRail
        session={session}
        sessionPending={sessionPending}
        ariaHidden={accountOpen || onboardingIsFullscreen}
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={navigate}
        onOpenAccount={openAccount}
      />
      <CareerMobileTopbar
        session={session}
        sessionPending={sessionPending}
        ariaHidden={accountOpen || onboardingIsFullscreen}
        tariffsAvailable={isNavigable('tariffs')}
        tariffsLockedReason={lockedReason('tariffs')}
        onNavigateHome={() => navigate('today')}
        onNavigateTariffs={() => navigate('tariffs')}
        onOpenAccount={openAccount}
      />

      <main
        id="career-main"
        className="career-main"
        aria-hidden={accountOpen ? true : undefined}
      >
        <AppErrorBoundary>
          {sessionPending ? (
            <SessionGate
              error={sessionError}
              waitIsLong={sessionWaitIsLong}
              onRetry={onRetrySession}
              onOpenLogin={onOpenLogin}
            />
          ) : invalidStorage ? (
            <div className="career-storage-warning" role="alert">
              <div>
                <strong>Сохранённый профиль не удалось прочитать</strong>
                <p>Удалите повреждённую локальную запись и начните заново.</p>
              </div>
              <button type="button" onClick={onClearWorkspace}>
                Очистить запись
              </button>
            </div>
          ) : null}
          {storageError ? (
            <p className="career-storage-warning" role="alert">
              {storageError}
            </p>
          ) : null}

          {intakeVisible ? (
            <OnboardingWizard
              key={`intake-${intakeSeed}`}
              onComplete={(input) => {
                setActiveView('opportunities');
                completeIntake(input);
              }}
              hasAccount={Boolean(session)}
              onStartedChange={setIntakeStarted}
              onSignIn={openAccount}
            />
          ) : null}
          {cabinetSession && !intakeVisible && activeView !== 'tariffs' ? (
            <CareerCabinet
              key={`${cabinetSession.candidateId}:${cabinetSession.displayName ?? ''}:${cabinetSession.email ?? ''}:${cabinetRevision}`}
              view={activeView as CareerCabinetView}
              navigationOptions={navigationOptions}
              session={cabinetSession}
              workspace={visibleWorkspace}
              onNavigate={navigate}
              onOpenTariffs={() => navigate('tariffs')}
              onOpenConnections={openConnections}
              onOpenExpert={openExpert}
              onUpdateWorkspace={onUpdateWorkspace}
            />
          ) : null}
          {!cabinetSession && visibleWorkspace && journey && activeView !== 'tariffs' ? (
            <CareerPathIndicator
              steps={buildPathIndicator({
                track: journey.track,
                // The wizard-only workspace has no server pool or recorded
                // applications of its own; the cabinet session below is where
                // both live once a candidate signs in (B165, B104).
                matchedPoolCount: 0,
                confirmedApplications: 0,
                activeSection: activeView,
              })}
              onNavigate={navigate}
            />
          ) : null}
          {!cabinetSession && visibleWorkspace && journey && activeView === 'today' ? (
            <TodayJourneyView
              workspace={visibleWorkspace}
              journey={journey}
              onNavigate={navigate}
              onOpenExpert={openExpert}
              onUpdateWorkspace={onUpdateWorkspace}
            />
          ) : null}
          {!cabinetSession && visibleWorkspace && journey && activeView === 'profile' ? (
            <ProfileJourneyView
              workspace={visibleWorkspace}
              journey={journey}
              onNavigate={navigate}
              onOpenExpert={openExpert}
              onUpdateWorkspace={onUpdateWorkspace}
            />
          ) : null}
          {!cabinetSession && visibleWorkspace && journey && activeView === 'career' ? (
            <CareerMapView
              workspace={visibleWorkspace}
              journey={journey}
              onNavigate={navigate}
              onOpenExpert={openExpert}
              onUpdateWorkspace={onUpdateWorkspace}
            />
          ) : null}
          {!cabinetSession && visibleWorkspace && journey && activeView === 'opportunities' ? (
            <OpportunitiesView
              workspace={visibleWorkspace}
              journey={journey}
              onNavigate={navigate}
              onOpenExpert={openExpert}
              onUpdateWorkspace={onUpdateWorkspace}
            />
          ) : null}
          {/* Трекер откликов читает `/api/v1/candidate/applications` — сессия
              обязательна; до входа в аккаунт кабинет ниже возьмёт этот раздел
              на себя (B251 S3). */}
          {!cabinetSession && visibleWorkspace && journey && activeView === 'responses' ? (
            <div className="career-responses-signin-hint">
              <h3>Отклики появятся после входа в аккаунт</h3>
              <p>Отклики хранятся на сервере вместе с профилем. Войдите, чтобы открыть их.</p>
              <button type="button" onClick={onOpenLogin}>
                Войти
              </button>
            </div>
          ) : null}
          {activeView === 'tariffs' ? <CareerTariffsView onOpenCoach={openExpert} /> : null}
        </AppErrorBoundary>
      </main>

      <CareerMobileNavigation
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={navigate}
        onOpenExpert={() => openExpert()}
        ariaHidden={accountOpen || onboardingIsFullscreen}
      />

      {expertPanelOpen ? (
        <CareerExpertPanel
          journey={journey}
          marketQuery={visibleWorkspace?.targetDirection}
          stage={expertConfig.stage}
          subject={expertConfig.subject}
          subjectTitle={expertConfig.subjectTitle}
          initialUser={session ?? null}
          loadingSession={sessionPending}
          mobileExpanded={expertSheetExpanded}
          onToggleMobileExpanded={() => setExpertSheetExpanded((expanded) => !expanded)}
          onIdentityChange={resetForAccount}
          onCommandPrepared={() => setCabinetRevision((revision) => revision + 1)}
          onEscape={handleExpertEscape}
          onClose={closeExpert}
        />
      ) : null}
      {accountOpen ? (
        <>
          <button
            className="career-expert-scrim"
            type="button"
            onClick={closeAccount}
            aria-label="Закрыть аккаунт"
            aria-hidden="true"
            tabIndex={-1}
          />
          <CareerAccountPanel
            initialUser={session}
            initialSection={accountSection}
            onClose={closeAccount}
            onIdentityChange={resetForAccount}
            onDataChanged={() => setCabinetRevision((revision) => revision + 1)}
            tariffsPlanName={planName}
            tariffsAvailable={isNavigable('tariffs')}
            tariffsLockedReason={lockedReason('tariffs')}
            onOpenTariffs={() => {
              closeAccount();
              navigate('tariffs');
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function SessionGate({
  error,
  waitIsLong,
  onRetry,
  onOpenLogin,
}: {
  error?: string;
  waitIsLong: boolean;
  onRetry: () => void;
  onOpenLogin: () => void;
}) {
  return (
    <section className="career-session-gate" aria-live="polite" aria-busy={!error}>
      {error ? (
        <div className="career-session-error" role="alert">
          <strong>Ошибка: сервер не ответил.</strong>
          <p>{error}</p>
          <div className="career-session-gate-actions">
            <button className="career-primary-button" type="button" onClick={onRetry}>
              Повторить
            </button>
            <button className="career-quiet-button" type="button" onClick={onOpenLogin}>
              Открыть вход
            </button>
          </div>
        </div>
      ) : (
        <>
          <CareerTodaySkeleton />
          {waitIsLong ? (
            <div className="career-session-gate-actions">
              <p className="career-session-gate-note" role="status">Загрузка дольше обычного.</p>
              <button className="career-primary-button" type="button" onClick={onRetry}>
                Повторить
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
