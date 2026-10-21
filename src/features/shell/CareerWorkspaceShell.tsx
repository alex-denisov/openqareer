import { useAdaptationPanelContext } from '../diary/adaptationDiscussion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser, CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { CareerCabinet, type CareerCabinetView } from '../cabinet/CareerCabinet';
import '../journey/consultant-strip.css';
import './mockup-shell.css';
import './mobile-shell.css';
import { CareerExpertPanel } from '../journey/CareerExpertPanel';
import {
  FirstRunWizard,
  firstRunDataToWorkspaceInput,
  useFirstRunSpecialState,
} from '../onboarding';
import {
  OpportunitiesView,
  ProfileJourneyView,
  TodayJourneyView,
} from '../journey/CareerJourneyViews';
import { CareerScreen } from '../career-map/CareerScreen';
import '../career-map/careerScreen.css';
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
import { isSectionNavigable, sectionLockReason } from './shellNavigation';
import {
  CareerMobileNavigation,
  CareerMobileTopbar,
  CareerNavigationRail,
} from './CareerShellNavigation';
import { CareerSessionGate } from './CareerSessionGate';
import { ResponsesAutomationSwitch } from './ResponsesAutomationSwitch';
import { BootstrapNotificationsBell, DesktopCabinetTopbar } from './DesktopCabinetTopbar';
import {
  DESKTOP_EXPERT_PREFERENCE_KEY,
  closeExpertPanel,
  expertPanelOpenOnWidthChange,
  focusConsultantTrigger,
  openExpertPanel,
  openIntakeConsultantPanel,
  hasClosedDesktopExpertPreference,
  initialExpertPanelOpen,
  matchesMedia,
  DOCKED_CONSULTANT_QUERY,
  pageNames,
  SESSION_GATE_DELAY_MS,
  stageForView,
  updateExpertStage,
  type ExpertPanelConfig,
  type ShellView,
} from './CareerWorkspaceShellHelpers';
import { CareerDiaryAccessProvider } from './careerDiaryAccess';
import { CareerDiaryShellControls, CareerDiaryAccessStatus } from './CareerDiaryShellControls';
import { useCareerDiaryShellAccess } from './useCareerDiaryShellAccess';
import { CareerAutomationWorkspace } from './CareerAutomationWorkspace';
import { NotificationsBell } from '../notifications/NotificationsBell';
import { NotificationsScreen } from '../notifications/NotificationsScreen';
import { RoleSkillAssessmentScreen } from '../skills/RoleSkillAssessmentScreen';
import type { SkillCheckFocus } from '../vacancies/VacancyQuizProposal';
import { requestVacancyFit } from '../vacancies/vacancyFitApi';
import type { ProfileMobileScene } from '../resume/profileMobileNavigation';

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
  const [skillCheckFocus, setSkillCheckFocus] = useState<SkillCheckFocus>();
  const [profileMobileScene, setProfileMobileScene] = useState<ProfileMobileScene | null>(null);
  const [returnToProfileSkills, setReturnToProfileSkills] = useState(false);
  const [skillQuizBankRequest, setSkillQuizBankRequest] = useState(0);
  const [expertConfig, setExpertConfig] = useState<ExpertPanelConfig>({
    open: initialExpertPanelOpen(sessionPending, initialView),
    stage: stageForView(initialView),
  });
  const [expertSheetExpanded, setExpertSheetExpanded] = useState(false);
  const autoOpenedExpert = useRef(sessionPending || hasClosedDesktopExpertPreference());
  const [railHint, setRailHint] = useState<string | null>(null);
  const [cabinetRevision, setCabinetRevision] = useState(0);
  const cabinetMountRevision = useRef(cabinetRevision);
  // Keep the same cabinet when entering Profile so a vacancy's pending
  // requirement survives navigation; refresh its data without remounting.
  if (activeView !== 'profile') cabinetMountRevision.current = cabinetRevision;
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountReturnToIntake, setAccountReturnToIntake] = useState(false);
  const [accountSection, setAccountSection] = useState<AccountSection>('security');
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [isWideViewport, setIsWideViewport] = useState(() => matchesMedia(DOCKED_CONSULTANT_QUERY));
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

  const intakeRequired = shouldShowIntake({
    sessionPending,
    hasWorkspace: Boolean(visibleWorkspace),
    hasCabinetSession: Boolean(cabinetSession),
    intakeStarted,
    isTodayView: true,
  });
  const intakeVisible = intakeRequired && activeView === 'today';
  const firstRunSpecial = useFirstRunSpecialState(
    intakeRequired ? (session?.candidateId ?? null) : null,
  );

  useEffect(() => {
    if (
      autoOpenedExpert.current ||
      !matchesMedia(DOCKED_CONSULTANT_QUERY) ||
      intakeVisible ||
      !session?.candidateId ||
      visibleWorkspace
    )
      return;
    autoOpenedExpert.current = true;
    setExpertConfig((current) => ({ ...current, open: true }));
  }, [intakeVisible, session?.candidateId, visibleWorkspace]);

  const expertPanelOpen =
    !accountOpen && (intakeVisible && isCompactViewport ? expertSheetExpanded : expertConfig.open);
  const expertPanelVisible = isCompactViewport
    ? expertPanelOpen && expertSheetExpanded
    : expertPanelOpen;

  useEffect(() => {
    if (!sessionPending) {
      setSessionWaitIsLong(false);
      return;
    }
    const timer = window.setTimeout(() => setSessionWaitIsLong(true), SESSION_GATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [sessionPending]);

  // The active page title stays in the mobile shell and browser tab.
  useEffect(() => {
    const title = intakeVisible
      ? 'Старт'
      : roleSkillAssessmentOpen
        ? 'Проверка навыков'
        : accountOpen
          ? 'Аккаунт'
          : pageNames[activeView];
    document.title = `${title} · openqareer`;
  }, [accountOpen, activeView, intakeVisible, roleSkillAssessmentOpen]);

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
    if (view !== 'profile') {
      setProfileMobileScene(null);
      setReturnToProfileSkills(false);
    }
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
    ) =>
      openExpertPanel(
        setExpertConfig,
        setExpertSheetExpanded,
        setAccountOpen,
        activeView,
        isCompactViewport,
        stage,
        subject,
        subjectTitle,
        initialPrompt,
      ),
    [activeView, isCompactViewport],
  );

  useAdaptationPanelContext(activeView, setExpertConfig);

  const closeExpert = useCallback(
    () => closeExpertPanel(setExpertConfig, setExpertSheetExpanded, focusConsultantTrigger),
    [],
  );

  const openIntakeConsultant = useCallback(
    (prompt?: string) => openIntakeConsultantPanel(openExpert, setExpertSheetExpanded, prompt),
    [openExpert],
  );

  const openRoleSkillAssessment = useCallback(
    (focus?: SkillCheckFocus) => {
      setSkillCheckFocus(focus);
      setProfileMobileScene(null);
      setReturnToProfileSkills(activeView === 'profile');
      setExpertConfig((previous) => ({ ...previous, open: false }));
      setExpertSheetExpanded(false);
      setRoleSkillAssessmentOpen(true);
    },
    [activeView],
  );

  const openSkillQuizBank = useCallback(() => {
    setRoleSkillAssessmentOpen(false);
    openExpert('profile');
    setSkillQuizBankRequest((request) => request + 1);
  }, [openExpert]);

  const closeRoleSkillAssessment = useCallback(() => {
    setRoleSkillAssessmentOpen(false);
    // The check may have confirmed the vacancy's skills: queue its fit again (B552).
    if (skillCheckFocus) void requestVacancyFit(skillCheckFocus.vacancyId).catch(() => undefined);
    setSkillCheckFocus(undefined);
    window.requestAnimationFrame(() => document.getElementById('career-main')?.focus());
  }, [skillCheckFocus]);

  const handleExpertEscape = useCallback(() => closeExpert(), [closeExpert]);

  const closeAccount = useCallback(() => {
    setAccountOpen(false);
    setAccountSection('security');
    setAccountReturnToIntake(false);
  }, []);
  const openAccount = useCallback(
    (section: AccountSection = 'security', returnToIntake = false) => {
      setExpertSheetExpanded(false);
      const shouldOpenDesktopExpert =
        typeof window !== 'undefined' && window.matchMedia(DOCKED_CONSULTANT_QUERY).matches;
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

  const completeFirstRun = useCallback(
    (
      data: Parameters<typeof firstRunDataToWorkspaceInput>[0],
      result?: Parameters<typeof firstRunDataToWorkspaceInput>[1],
    ) => {
      setActiveView('opportunities');
      completeIntake(firstRunDataToWorkspaceInput(data, result));
    },
    [completeIntake],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsCompactViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(DOCKED_CONSULTANT_QUERY);
    const onChange = () => {
      setIsWideViewport(media.matches);
      const open = expertPanelOpenOnWidthChange(media.matches);
      setExpertConfig((config) => (config.open === open ? config : { ...config, open }));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const desktopPageTitle = intakeVisible
    ? 'Старт'
    : roleSkillAssessmentOpen
      ? 'Проверка навыков'
      : pageNames[activeView];

  useEffect(() => {
    if (!matchesMedia(DOCKED_CONSULTANT_QUERY)) return;
    try {
      window.localStorage.setItem(
        DESKTOP_EXPERT_PREFERENCE_KEY,
        expertConfig.open ? 'open' : 'strip',
      );
    } catch {
      // The panel preference is optional when browser storage is unavailable.
    }
  }, [expertConfig.open]);

  return (
    <CareerDiaryAccessProvider value={diaryAccess}>
      <div
        className={`career-shell ${expertPanelOpen ? 'expert-is-open' : ''} ${!isCompactViewport && !accountOpen ? 'consultant-desktop' : ''} ${!expertPanelOpen ? 'consultant-is-strip' : ''} ${!isWideViewport && expertPanelOpen ? 'consultant-is-overlay' : ''} ${
          activeView === 'opportunities' ? 'career-shell--vacancies' : ''
        }`}
        data-testid="career-shell"
        data-shell-view={activeView}
      >
        <a className="career-skip-link" href="#career-main">
          К содержанию
        </a>

        <CareerNavigationRail
          inactive={intakeVisible}
          session={session}
          sessionPending={sessionPending}
          activeView={activeView}
          isNavigable={isNavigable}
          lockedReason={lockedReason}
          onNavigate={navigate}
          onOpenAccount={openAccount}
          onNavigationHintChange={(hint) => setRailHint(hint ?? null)}
        />
        {activeView === 'opportunities' ? null : (
          <CareerMobileTopbar
            activeView={activeView}
            title={
              accountOpen
                ? 'Аккаунт'
                : profileMobileScene && activeView === 'profile'
                  ? profileMobileScene.title
                  : desktopPageTitle
            }
            onBack={
              !accountOpen && roleSkillAssessmentOpen
                ? closeRoleSkillAssessment
                : !accountOpen && activeView === 'profile'
                  ? profileMobileScene?.onBack
                  : undefined
            }
            pendingProposalCount={pendingProposalCount}
            expertOpen={expertPanelVisible}
            onOpenConsultant={() => (intakeVisible ? openIntakeConsultant() : openExpert())}
            notificationsSlot={
              cabinetSession &&
              !sessionPending &&
              !accountOpen &&
              !intakeVisible &&
              isCompactViewport ? (
                <NotificationsBell
                  unreadCount={notificationUnreadCount}
                  onUnreadCountChange={setNotificationUnreadCount}
                  onOpenCenter={openNotificationCenter}
                  onOpenSettings={openNotificationSettings}
                />
              ) : sessionPending && isCompactViewport ? (
                <BootstrapNotificationsBell />
              ) : null
            }
          />
        )}

        <main id="career-main" className="career-main">
          <DesktopCabinetTopbar
            title={desktopPageTitle}
            railHint={railHint}
            bootStatus={
              sessionPending && !sessionError ? 'Проверяем вход и читаем ваш профиль' : null
            }
            showNotifications={!isCompactViewport}
            showConsultantButton={false}
            onOpenConsultant={() => openExpert()}
            session={session}
            sessionPending={sessionPending}
            hidden={accountOpen}
            unreadCount={notificationUnreadCount}
            onUnreadCountChange={setNotificationUnreadCount}
            onOpenCenter={openNotificationCenter}
            onOpenSettings={openNotificationSettings}
          />
          <div className="career-main-content">
            {intakeRequired || (sessionPending && intakeStarted) ? (
              <div
                data-intake-screen={intakeVisible && !accountOpen ? 'visible' : undefined}
                hidden={accountOpen || !intakeVisible}
              >
                <FirstRunWizard
                  key={`intake-${intakeSeed}`}
                  onComplete={completeFirstRun}
                  hasAccount={Boolean(session)}
                  onStartedChange={setIntakeStarted}
                  isMobile={isCompactViewport}
                  showConsultantPanel={false}
                  partialSourcesMessage={firstRunSpecial.partialMessage}
                  importProgressLabel={firstRunSpecial.importLabel}
                  onConnectSource={() => openAccount('connections', true)}
                  onOpenConsultant={openIntakeConsultant}
                />
              </div>
            ) : null}
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
                  <CareerSessionGate
                    error={sessionError}
                    waitIsLong={sessionWaitIsLong}
                    onRetry={onRetrySession}
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

                {roleSkillAssessmentOpen && cabinetSession ? (
                  <RoleSkillAssessmentScreen
                    session={cabinetSession}
                    focus={skillCheckFocus}
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
                isCompactViewport &&
                (activeView === 'responses' || activeView === 'automation') ? (
                  <ResponsesAutomationSwitch
                    active={activeView}
                    onSelect={(segment) => navigate(segment)}
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
                    key={`${cabinetSession.candidateId}:${cabinetSession.displayName ?? ''}:${cabinetSession.email ?? ''}:${cabinetMountRevision.current}`}
                    refreshRevision={activeView === 'profile' ? cabinetRevision : undefined}
                    view={activeView as CareerCabinetView}
                    initialProfileTab={returnToProfileSkills ? 'skills' : undefined}
                    navigationOptions={navigationOptions}
                    session={cabinetSession}
                    workspace={visibleWorkspace}
                    onNavigate={navigate}
                    onOpenAutomation={() => navigate('automation')}
                    onOpenTariffs={() => navigate('tariffs')}
                    onOpenConnections={openConnections}
                    onOpenNotifications={openNotifications}
                    onOpenExpert={openExpert}
                    onOpenSkillQuizBank={openSkillQuizBank}
                    onOpenRoleSkillAssessment={() => openRoleSkillAssessment()}
                    onMobileSceneChange={setProfileMobileScene}
                    onUpdateWorkspace={onUpdateWorkspace}
                  />
                ) : null}
                {cabinetSession && !intakeVisible && activeView === 'career' ? (
                  <CareerScreen
                    hasProfile={true}
                    isMobile={isCompactViewport}
                    onNavigate={(v) => navigate(v as ShellView)}
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
                    onOpenExpert={() => openExpert('responses')}
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
                    onNavigate={(v) => navigate(v as ShellView)}
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
          onOpenExpert={() => (intakeVisible ? openIntakeConsultant() : openExpert())}
          onOpenAccount={openAccount}
          sessionPending={sessionPending}
          accountOpen={accountOpen}
          expertOpen={expertPanelVisible}
        />

        {!isCompactViewport && !isWideViewport && expertPanelOpen ? (
          <button
            className="consultant-scrim"
            aria-label="Свернуть консультанта"
            onClick={closeExpert}
          />
        ) : null}
        {isCompactViewport || !accountOpen ? (
          <aside
            className={`panel-col${expertPanelVisible ? ' is-open' : ''}`}
            role="presentation"
            aria-hidden={isCompactViewport && !expertPanelVisible ? true : undefined}
          >
            {expertPanelVisible ? (
              <button
                className="career-consultant-backdrop"
                type="button"
                aria-label="Закрыть консультанта"
                tabIndex={-1}
                onClick={closeExpert}
              />
            ) : null}
            <CareerExpertPanel
              intakeMode={intakeVisible}
              collapsed={!expertPanelVisible}
              overlay={expertPanelVisible && (isCompactViewport || !isWideViewport)}
              onExpand={isCompactViewport ? undefined : () => openExpert()}
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
              onProposalCountChange={setPendingProposalCount}
              onStartSkillCheck={openRoleSkillAssessment}
              onIdentityChange={resetForAccount}
              onCommandPrepared={() => setCabinetRevision((revision) => revision + 1)}
              skillQuizBankRequest={skillQuizBankRequest}
              onEscape={handleExpertEscape}
              onStageChange={(stage) => updateExpertStage(setExpertConfig, stage)}
              onClose={closeExpert}
            />
          </aside>
        ) : null}
      </div>
    </CareerDiaryAccessProvider>
  );
}
