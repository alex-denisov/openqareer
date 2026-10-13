import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser, CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { CareerCabinet, type CareerCabinetView } from '../cabinet/CareerCabinet';
import { CaretUp, Sparkle } from '@phosphor-icons/react';
import { CareerExpertPanel, STAGE_TITLE } from '../journey/CareerExpertPanel';
import { OnboardingWizard } from '../journey/OnboardingWizard';
import {
  OpportunitiesView,
  ProfileJourneyView,
  TodayJourneyView,
} from '../journey/CareerJourneyViews';
import { CareerScreen } from '../career-map/CareerScreen';
import { buildCareerJourney } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace, WorkspaceInput } from '../workspace/workspaceStorage';
import { TariffsScreen } from './TariffsScreen';
import { createIntakeCompletion } from './intakeCompletion';
import { CareerAccountWorkspace } from '../account/CareerAccountWorkspace';
import { CareerAccountAccess } from '../account/CareerAccountAccess';
import type { AccountSection } from '../account/accountTypes';
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
import { CareerDiaryAccessProvider } from './careerDiaryAccess';
import { CareerDiaryShellControls, CareerDiaryAccessStatus } from './CareerDiaryShellControls';
import { useCareerDiaryShellAccess } from './useCareerDiaryShellAccess';
import { CareerAutomationWorkspace } from './CareerAutomationWorkspace';
import { NotificationsBell } from '../notifications/NotificationsBell';
import { NotificationsScreen } from '../notifications/NotificationsScreen';
import { RoleSkillAssessmentScreen } from '../skills/RoleSkillAssessmentScreen';

type ShellView = ShellSection;

/** Раздел, в котором консультант открывается без явного этапа. */
function stageForView(view: ShellView): CoachTurnStage {
  if (view === 'profile') return 'profile';
  if (view === 'career') return 'career';
  if (view === 'opportunities') return 'vacancies';
  if (view === 'responses' || view === 'automation') return 'responses';
  return 'today';
}

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
  career: 'Карьера',
  opportunities: 'Вакансии',
  responses: 'Отклики',
  notifications: 'Уведомления',
  automation: 'Автоматизация',
  diary: 'Карьерный дневник',
  tariffs: 'Тарифы',
};

const SESSION_GATE_DELAY_MS = 4_000;
const DESKTOP_EXPERT_PREFERENCE_KEY = 'openqareer.desktop-expert-panel';

function readDesktopExpertPreference(): 'open' | 'closed' | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(DESKTOP_EXPERT_PREFERENCE_KEY);
    return value === 'open' || value === 'closed' ? value : null;
  } catch {
    return null;
  }
}

function matchesMedia(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  );
}

function hasClosedDesktopExpertPreference(): boolean {
  return matchesMedia('(min-width: 1280px)') && readDesktopExpertPreference() === 'closed';
}

function initialExpertPanelOpen(sessionPending: boolean, initialView: ShellView): boolean {
  if (typeof window === 'undefined') return false;
  const desktop = matchesMedia('(min-width: 1280px)');
  if (desktop && readDesktopExpertPreference() === 'closed') return false;
  if (sessionPending) return true;
  return desktop || (initialView === 'opportunities' && matchesMedia('(min-width: 761px)'));
}

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
  useEffect(() => {
    document.getElementById('root')?.removeAttribute('aria-busy');
  }, []);
  const [activeView, setActiveView] = useState<ShellView>(() => {
    if (typeof window !== 'undefined') {
      const searchParam = new URLSearchParams(window.location.search).get('view');
      if (searchParam === 'career') return 'career';
    }
    return initialView;
  });
  const [roleSkillAssessmentOpen, setRoleSkillAssessmentOpen] = useState(false);
  const [expertConfig, setExpertConfig] = useState<{
    open: boolean;
    stage: CoachTurnStage;
    subject?: CoachTurnSubject;
    subjectTitle?: string;
    initialPrompt?: string;
  }>({
    open: initialExpertPanelOpen(sessionPending, initialView),
    stage: stageForView(initialView),
  });
  const [expertSheetExpanded, setExpertSheetExpanded] = useState(false);
  const autoOpenedExpert = useRef(sessionPending || hasClosedDesktopExpertPreference());
  const [railHint, setRailHint] = useState<string | null>(null);
  const [cabinetRevision, setCabinetRevision] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountReturnToIntake, setAccountReturnToIntake] = useState(false);
  const [accountSection, setAccountSection] = useState<AccountSection>('security');
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    matchesMedia('(max-width: 760px)'),
  );
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
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
  const diaryAccess = useCareerDiaryShellAccess(
    Boolean(cabinetSession),
    cabinetSession?.candidateId,
    cabinetRevision,
  );
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
    if (autoOpenedExpert.current || intakeVisible || !session?.candidateId || visibleWorkspace)
      return;
    autoOpenedExpert.current = true;
    setExpertConfig((current) => ({ ...current, open: true }));
  }, [intakeVisible, session?.candidateId, visibleWorkspace]);

  // onboarding.html is full-screen from its first step (owner decision
  // 2026-09-24, replacing the B141 exception that kept the rail on step 1 for
  // its account door); an anonymous candidate signs in from the wizard's own
  // top bar instead.
  const onboardingIsFullscreen = intakeVisible;
  const expertPanelOpen = expertConfig.open && !onboardingIsFullscreen;

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
    document.title = `${roleSkillAssessmentOpen ? 'Проверка навыков' : accountOpen ? 'Аккаунт' : pageNames[activeView]} · openqareer`;
  }, [accountOpen, activeView, roleSkillAssessmentOpen]);

  const navigationState = {
    careerPictureReady,
    resumeAvailable,
    candidateSessionAvailable: Boolean(cabinetSession),
    careerDiaryAvailable:
      diaryAccess.isVisible ||
      (!isCompactViewport && ['loading', 'error'].includes(diaryAccess.state)),
    canUseWorkspaceViews,
  };

  function isNavigable(view: ShellView) {
    if (view === 'automation')
      return Boolean(cabinetSession) && isSectionNavigable('responses', navigationState);
    return isSectionNavigable(view, navigationState);
  }

  function lockedReason(view: ShellView): string {
    if (view === 'automation') {
      if (!careerPictureReady) return sectionLockReason('responses', navigationState);
      return cabinetSession
        ? sectionLockReason('responses', navigationState)
        : 'Войдите в аккаунт, чтобы открыть автоматизацию';
    }
    return sectionLockReason(view, navigationState);
  }

  useEffect(() => {
    if (sessionPending) return;
    if (
      activeView === 'diary' &&
      (diaryAccess.state === 'disabled' ||
        (diaryAccess.state === 'ready' && !diaryAccess.isVisible))
    ) {
      setActiveView('today');
    }
  }, [activeView, diaryAccess.isVisible, diaryAccess.state, sessionPending]);

  const [navigationOptions, setNavigationOptions] = useState<NavigationOptions | undefined>();

  function navigate(view: ShellView, options?: NavigationOptions) {
    setRoleSkillAssessmentOpen(false);
    if (!isNavigable(view)) return;
    setAccountOpen(false);
    setAccountSection('security');
    setAccountReturnToIntake(false);
    if (view !== 'notifications') setSelectedNotificationId(null);
    setActiveView(view);
    setNavigationOptions(options);
    setRailHint(null);
    setExpertConfig((previous) => ({
      ...previous,
      stage: stageForView(view),
      subject: undefined,
      subjectTitle: undefined,
      initialPrompt: undefined,
    }));
    setExpertSheetExpanded(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('career-main')?.scrollTo({
        top: 0,
        behavior: 'auto',
      });
    });
  }

  const openExpert = useCallback(
    (
      stage?: CoachTurnStage,
      subject?: CoachTurnSubject,
      subjectTitle?: string,
      initialPrompt?: string,
    ) => {
      setExpertSheetExpanded(false);
      setExpertConfig({
        open: true,
        stage: stage ?? stageForView(activeView),
        subject,
        subjectTitle,
        initialPrompt,
      });
    },
    [activeView],
  );

  const closeExpert = useCallback(() => {
    setExpertSheetExpanded(false);
    setExpertConfig((prev) => ({ ...prev, open: false }));
  }, []);

  const openRoleSkillAssessment = useCallback(() => {
    setExpertConfig((previous) => ({ ...previous, open: false }));
    setExpertSheetExpanded(false);
    setRoleSkillAssessmentOpen(true);
  }, []);

  const closeRoleSkillAssessment = useCallback(() => {
    setRoleSkillAssessmentOpen(false);
    window.requestAnimationFrame(() => document.getElementById('career-main')?.focus());
  }, []);

  useEffect(() => {
    if (onboardingIsFullscreen && expertConfig.open) closeExpert();
  }, [closeExpert, expertConfig.open, onboardingIsFullscreen]);

  const handleExpertEscape = useCallback(() => {
    const onPhone =
      typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 760px)').matches);
    if (onPhone && expertSheetExpanded) {
      setExpertSheetExpanded(false);
      return;
    }
    closeExpert();
  }, [closeExpert, expertSheetExpanded]);

  const closeAccount = useCallback(() => {
    setAccountOpen(false);
    setAccountSection('security');
    setAccountReturnToIntake(false);
  }, []);
  const openAccount = useCallback(
    (section: AccountSection = 'security', returnToIntake = false) => {
      setExpertSheetExpanded(false);
      const shouldOpenDesktopExpert =
        typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches;
      setExpertConfig((previous) => ({
        ...previous,
        open: previous.open || shouldOpenDesktopExpert,
        subjectTitle: 'Аккаунт',
      }));
      setAccountSection(section);
      setAccountReturnToIntake(returnToIntake);
      setAccountOpen(true);
    },
    [],
  );

  const openNotificationSettings = useCallback(() => openAccount('notif'), [openAccount]);
  function openNotificationCenter(notificationId?: string) {
    setSelectedNotificationId(notificationId ?? null);
    navigate('notifications');
  }
  const openNotifications = useCallback(() => {
    openAccount('notif');
  }, [openAccount]);
  const openConnections = useCallback(() => openAccount('connections'), [openAccount]);
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
  const handleAccountAccessIdentityChange = useCallback(
    (nextSession: AuthUser | null) => {
      resetForAccount(nextSession);
      if (nextSession && nextSession.emailVerified !== false && accountReturnToIntake) {
        closeAccount();
      }
    },
    [accountReturnToIntake, closeAccount, resetForAccount],
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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsCompactViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const desktopPageTitle = roleSkillAssessmentOpen ? 'Проверка навыков' : pageNames[activeView];

  useEffect(() => {
    if (!matchesMedia('(min-width: 1280px)')) return;
    try {
      window.localStorage.setItem(
        DESKTOP_EXPERT_PREFERENCE_KEY,
        expertConfig.open ? 'open' : 'closed',
      );
    } catch {
      // The panel preference is optional when browser storage is unavailable.
    }
  }, [expertConfig.open]);

  return (
    <CareerDiaryAccessProvider value={diaryAccess}>
      <div
        className={`career-shell ${expertPanelOpen ? 'expert-is-open' : ''} ${
          activeView === 'opportunities' ? 'career-shell--vacancies' : ''
        } ${onboardingIsFullscreen ? 'career-shell--onboarding-fullscreen' : ''}`}
        data-testid="career-shell"
        data-shell-view={activeView}
      >
        <a className="career-skip-link" href="#career-main">
          К содержанию
        </a>

        <CareerNavigationRail
          session={session}
          sessionPending={sessionPending}
          ariaHidden={onboardingIsFullscreen}
          activeView={activeView}
          isNavigable={isNavigable}
          lockedReason={lockedReason}
          onNavigate={navigate}
          onOpenAccount={openAccount}
          onNavigationHintChange={(hint) => setRailHint(hint ?? null)}
        />
        {activeView === 'opportunities' ? null : (
          <CareerMobileTopbar
            session={session}
            sessionPending={sessionPending}
            activeView={activeView}
            ariaHidden={onboardingIsFullscreen}
            tariffsAvailable={isNavigable('tariffs')}
            tariffsLockedReason={lockedReason('tariffs')}
            onNavigateHome={() => navigate('today')}
            onNavigateResponses={() => navigate('responses')}
            onNavigateTariffs={() => navigate('tariffs')}
            onOpenAccount={openAccount}
            onOpenConsultant={() => openExpert('responses')}
          />
        )}

        {cabinetSession &&
        !sessionPending &&
        !accountOpen &&
        !onboardingIsFullscreen &&
        !expertPanelOpen &&
        isCompactViewport ? (
          <NotificationsBell
            unreadCount={notificationUnreadCount}
            onUnreadCountChange={setNotificationUnreadCount}
            onOpenCenter={openNotificationCenter}
            onOpenSettings={openNotificationSettings}
          />
        ) : null}

        <main id="career-main" className="career-main">
          <DesktopCabinetTopbar
            title={desktopPageTitle}
            railHint={railHint}
            showNotifications={!isCompactViewport}
            showConsultantButton={!isCompactViewport && !expertPanelOpen}
            onOpenConsultant={() => openExpert()}
            session={session}
            sessionPending={sessionPending}
            hidden={onboardingIsFullscreen || accountOpen}
            unreadCount={notificationUnreadCount}
            onUnreadCountChange={setNotificationUnreadCount}
            onOpenCenter={openNotificationCenter}
            onOpenSettings={openNotificationSettings}
          />
          <div className="career-main-content">
            {accountOpen ? (
              session && session.emailVerified !== false ? (
                <CareerAccountWorkspace
                  initialUser={session}
                  initialSection={accountSection}
                  onClose={closeAccount}
                  onIdentityChange={resetForAccount}
                  onSessionUpdate={onSessionChange}
                  onDataChanged={() => setCabinetRevision((revision) => revision + 1)}
                  onOpenTariffs={() => {
                    closeAccount();
                    navigate('tariffs');
                  }}
                />
              ) : (
                <CareerAccountAccess
                  session={session ?? null}
                  onIdentityChange={handleAccountAccessIdentityChange}
                  onClose={closeAccount}
                />
              )
            ) : (
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
                    onSignIn={() => openAccount('security', true)}
                  />
                ) : null}
                {roleSkillAssessmentOpen && cabinetSession ? (
                  <RoleSkillAssessmentScreen
                    session={cabinetSession}
                    onClose={closeRoleSkillAssessment}
                    onOpenOpportunities={() => navigate('opportunities')}
                  />
                ) : null}
                {cabinetSession && activeView === 'diary' ? <CareerDiaryAccessStatus /> : null}
                {cabinetSession && activeView === 'diary' && diaryAccess.isVisible ? (
                  <CareerDiaryShellControls
                    onDataChanged={() => setCabinetRevision((revision) => revision + 1)}
                  />
                ) : null}
                {cabinetSession &&
                !intakeVisible &&
                activeView === 'automation' &&
                cabinetSession.candidateId ? (
                  <CareerAutomationWorkspace
                    key={cabinetSession.candidateId}
                    candidateId={cabinetSession.candidateId}
                    onOpenConsultant={() => openExpert('responses')}
                    onOpenConnections={openConnections}
                    onOpenTariffs={() => navigate('tariffs')}
                  />
                ) : null}
                {cabinetSession &&
                !intakeVisible &&
                activeView !== 'tariffs' &&
                activeView !== 'automation' &&
                activeView !== 'notifications' &&
                activeView !== 'career' &&
                !roleSkillAssessmentOpen &&
                (activeView !== 'diary' || diaryAccess.isVisible) ? (
                  <CareerCabinet
                    key={`${cabinetSession.candidateId}:${cabinetSession.displayName ?? ''}:${cabinetSession.email ?? ''}:${cabinetRevision}`}
                    view={activeView as CareerCabinetView}
                    navigationOptions={navigationOptions}
                    session={cabinetSession}
                    workspace={visibleWorkspace}
                    onNavigate={navigate}
                    onOpenAutomation={() => navigate('automation')}
                    onOpenTariffs={() => navigate('tariffs')}
                    onOpenConnections={openConnections}
                    onOpenNotifications={openNotifications}
                    onOpenExpert={openExpert}
                    onUpdateWorkspace={onUpdateWorkspace}
                  />
                ) : null}
                {cabinetSession && !intakeVisible && activeView === 'career' ? (
                  <CareerScreen
                    hasProfile={true}
                    isMobile={isCompactViewport}
                    onNavigate={(v) => navigate(v as ShellSection)}
                    onOpenExpert={() => openExpert('career')}
                    onOpenVacancies={() => navigate('opportunities', { focusRoleFilter: true })}
                    onCheckSkills={() => navigate('profile')}
                    onOpenProfile={() => navigate('profile')}
                  />
                ) : null}
                {cabinetSession && !intakeVisible && activeView === 'notifications' ? (
                  <NotificationsScreen
                    key={activeView}
                    initialSelectedId={selectedNotificationId}
                    onUnreadCountChange={setNotificationUnreadCount}
                    onNavigate={navigate}
                    onOpenSettings={openNotificationSettings}
                  />
                ) : null}
                {!roleSkillAssessmentOpen &&
                !cabinetSession &&
                visibleWorkspace &&
                journey &&
                activeView !== 'tariffs' ? (
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
                {!roleSkillAssessmentOpen &&
                !cabinetSession &&
                visibleWorkspace &&
                journey &&
                activeView === 'today' ? (
                  <TodayJourneyView
                    workspace={visibleWorkspace}
                    journey={journey}
                    onNavigate={navigate}
                    onOpenExpert={openExpert}
                    onUpdateWorkspace={onUpdateWorkspace}
                  />
                ) : null}
                {!roleSkillAssessmentOpen &&
                !cabinetSession &&
                visibleWorkspace &&
                journey &&
                activeView === 'profile' ? (
                  <ProfileJourneyView
                    workspace={visibleWorkspace}
                    journey={journey}
                    onNavigate={navigate}
                    onOpenExpert={openExpert}
                    onUpdateWorkspace={onUpdateWorkspace}
                  />
                ) : null}
                {!roleSkillAssessmentOpen &&
                !cabinetSession &&
                visibleWorkspace &&
                journey &&
                activeView === 'career' ? (
                  <CareerScreen
                    hasProfile={Boolean(
                      visibleWorkspace.resumeText ||
                      visibleWorkspace.currentSituation ||
                      visibleWorkspace.targetDirection,
                    )}
                    isMobile={isCompactViewport}
                    isMarketStale={journey.markets[0]?.state !== 'sample-ready'}
                    onNavigate={(v) => navigate(v as ShellSection)}
                    onOpenExpert={() => openExpert('career')}
                    onOpenVacancies={() => navigate('opportunities', { focusRoleFilter: true })}
                    onCheckSkills={() => navigate('profile')}
                    onOpenProfile={() => navigate('profile')}
                  />
                ) : null}
                {!roleSkillAssessmentOpen &&
                !cabinetSession &&
                visibleWorkspace &&
                journey &&
                activeView === 'opportunities' ? (
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
                {!roleSkillAssessmentOpen &&
                !cabinetSession &&
                visibleWorkspace &&
                journey &&
                activeView === 'responses' ? (
                  <div className="career-responses-signin-hint">
                    <h3>Отклики появятся после входа в аккаунт</h3>
                    <p>Отклики хранятся на сервере вместе с профилем. Войдите, чтобы открыть их.</p>
                    <button type="button" onClick={onOpenLogin}>
                      Войти
                    </button>
                  </div>
                ) : null}
                {!roleSkillAssessmentOpen && activeView === 'tariffs' ? <TariffsScreen /> : null}
              </AppErrorBoundary>
            )}
          </div>
        </main>

        <CareerMobileNavigation
          activeView={activeView}
          isNavigable={isNavigable}
          lockedReason={lockedReason}
          onNavigate={navigate}
          onOpenExpert={() => openExpert()}
          ariaHidden={onboardingIsFullscreen}
        />

        {activeView !== 'opportunities' &&
        !expertPanelOpen &&
        !accountOpen &&
        !onboardingIsFullscreen &&
        !roleSkillAssessmentOpen &&
        activeView !== 'automation' ? (
          <button
            className="career-expert-peek"
            type="button"
            onClick={() => openExpert()}
            aria-label="Открыть консультанта"
          >
            <span className="career-expert-peek-icon">
              <Sparkle size={18} weight="fill" />
            </span>
            <span className="career-expert-peek-text">
              <strong>Консультант</strong>
              <small>{STAGE_TITLE[stageForView(activeView)]}</small>
            </span>
            <CaretUp size={20} />
          </button>
        ) : null}
        {expertPanelOpen ? (
          <CareerExpertPanel
            journey={journey}
            marketQuery={visibleWorkspace?.targetDirection}
            stage={expertConfig.stage}
            subject={expertConfig.subject}
            subjectTitle={expertConfig.subjectTitle}
            initialPrompt={expertConfig.initialPrompt}
            initialUser={session ?? null}
            loadingSession={sessionPending}
            mobileExpanded={expertSheetExpanded}
            onToggleMobileExpanded={() => setExpertSheetExpanded((expanded) => !expanded)}
            onIdentityChange={resetForAccount}
            onCommandPrepared={() => setCabinetRevision((revision) => revision + 1)}
            onOpenRoleSkillAssessment={openRoleSkillAssessment}
            onEscape={handleExpertEscape}
            onStageChange={(stage) =>
              setExpertConfig((previous) => ({
                ...previous,
                stage,
                subject: undefined,
                subjectTitle: undefined,
                initialPrompt: undefined,
              }))
            }
            onClose={closeExpert}
          />
        ) : null}
      </div>
    </CareerDiaryAccessProvider>
  );
}

interface DesktopCabinetTopbarProps {
  readonly title: string;
  readonly railHint: string | null;
  readonly showNotifications: boolean;
  readonly showConsultantButton: boolean;
  readonly onOpenConsultant: () => void;
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly ariaHidden?: boolean;
  readonly hidden?: boolean;
  readonly unreadCount: number;
  readonly onUnreadCountChange: (count: number) => void;
  readonly onOpenCenter: (notificationId?: string) => void;
  readonly onOpenSettings: () => void;
}

function DesktopCabinetTopbar({
  title,
  railHint,
  showNotifications,
  showConsultantButton,
  onOpenConsultant,
  session,
  sessionPending,
  ariaHidden,
  hidden,
  unreadCount,
  onUnreadCountChange,
  onOpenCenter,
  onOpenSettings,
}: DesktopCabinetTopbarProps) {
  if (hidden) return null;
  return (
    <header
      className="career-desktop-topbar"
      aria-hidden={ariaHidden || undefined}
      aria-label={`Раздел ${title}`}
    >
      <h1>{title}</h1>
      {railHint ? (
        <span className="career-desktop-topbar-hint" role="status" aria-live="polite">
          {railHint}
        </span>
      ) : null}
      <div className="career-desktop-topbar-actions">
        {showConsultantButton ? (
          <button
            className="career-notification-bell career-desktop-expert-trigger"
            type="button"
            aria-label="Открыть консультанта"
            onClick={onOpenConsultant}
          >
            <Sparkle size={22} aria-hidden="true" />
          </button>
        ) : null}
        {showNotifications && session?.candidateId && !sessionPending ? (
          <NotificationsBell
            unreadCount={unreadCount}
            onUnreadCountChange={onUnreadCountChange}
            onOpenCenter={onOpenCenter}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
      </div>
    </header>
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
              <p className="career-session-gate-note" role="status">
                Загрузка дольше обычного.
              </p>
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
