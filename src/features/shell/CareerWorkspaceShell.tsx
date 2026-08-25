import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CaretLeft,
  CaretRight,
  Compass,
  FileText,
  House,
  Path,
  ShieldCheck,
  UserCircle,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import type { AuthUser } from '../coach/coachApi';
import { CareerCabinet, type CareerCabinetView } from '../cabinet/CareerCabinet';
import { CareerExpertPanel } from '../journey/CareerExpertPanel';
import { CareerIntake } from '../journey/CareerIntake';
import {
  CareerMapView,
  OpportunitiesView,
  ProfileJourneyView,
  TodayJourneyView,
} from '../journey/CareerJourneyViews';
import { buildCareerJourney } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace, WorkspaceInput } from '../workspace/workspaceStorage';
import { CareerTariffsView } from './CareerTariffsView';
import { createIntakeCompletion } from './intakeCompletion';
import { CareerAccountPanel } from './CareerAccountPanel';
import { AppErrorBoundary } from './AppErrorBoundary';
import {
  keepsIntakeAcrossIdentityChange,
  shouldShowIntake,
} from './intakeContinuity';
import {
  isSectionNavigable,
  sectionLockReason,
  type ShellSection,
} from './shellNavigation';

type ShellView = ShellSection;

interface CareerWorkspaceShellProps {
  workspace?: CandidateWorkspace;
  invalidStorage?: boolean;
  storageError?: string;
  connectionNotice?: string;
  onDismissConnectionNotice?: () => void;
  onSaveWorkspace?: (input: WorkspaceInput) => void | Promise<void>;
  onUpdateWorkspace?: (workspace: CandidateWorkspace) => void;
  onClearWorkspace?: () => void;
  session?: AuthUser | null;
  sessionPending?: boolean;
  sessionError?: string;
  onRetrySession?: () => void;
  onSessionChange?: (session: AuthUser | null) => void;
}

const primaryNavigation: Array<{
  id: Exclude<ShellView, 'tariffs'>;
  label: string;
  shortLabel: string;
  icon: Icon;
}> = [
  { id: 'today', label: 'Сегодня', shortLabel: 'Сегодня', icon: House },
  { id: 'profile', label: 'Профиль', shortLabel: 'Профиль', icon: UserCircle },
  { id: 'resume', label: 'Резюме', shortLabel: 'Резюме', icon: FileText },
  { id: 'career', label: 'Карьера', shortLabel: 'Карьера', icon: Path },
  {
    id: 'opportunities',
    label: 'Возможности',
    shortLabel: 'Шансы',
    icon: Compass,
  },
];

const pageNames: Record<ShellView, string> = {
  today: 'Сегодня',
  profile: 'Профиль',
  resume: 'Резюме',
  career: 'Карьера',
  opportunities: 'Возможности',
  tariffs: 'Тарифы',
};

/**
 * A session check normally finishes in tens of milliseconds. Rendering the
 * explanation immediately turned that into a flash of a full-height heading on
 * every mount, so the screen only explains itself once the wait is real.
 */
const SESSION_GATE_DELAY_MS = 400;

/** Remembers whether the rail is open, so the choice survives a reload. */
const RAIL_EXPANDED_KEY = 'openqareer.rail.expanded';

function readRailPreference(): boolean {
  try {
    return window.localStorage.getItem(RAIL_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function CareerWorkspaceShell({
  workspace,
  invalidStorage = false,
  storageError,
  connectionNotice,
  onDismissConnectionNotice,
  onSaveWorkspace = () => undefined,
  onUpdateWorkspace = () => undefined,
  onClearWorkspace = () => undefined,
  session,
  sessionPending = false,
  sessionError,
  onRetrySession = () => undefined,
  onSessionChange = () => undefined,
}: CareerWorkspaceShellProps) {
  const [activeView, setActiveView] = useState<ShellView>('today');
  const [expertOpen, setExpertOpen] = useState(false);
  const [cabinetRevision, setCabinetRevision] = useState(0);
  const [accountOpen, setAccountOpen] = useState(
    () => typeof window !== 'undefined' && window.location.pathname === '/auth/reset-password',
  );
  const [sessionWaitIsLong, setSessionWaitIsLong] = useState(false);
  const [railExpanded, setRailExpanded] = useState(
    () => typeof window !== 'undefined' && readRailPreference(),
  );
  // A diagnostic that is under way owns the «Сегодня» screen even after the
  // account its own source step demanded arrives (B141).
  const [intakeStarted, setIntakeStarted] = useState(false);
  // Identity, not the candidate id, decides when the wizard is thrown away: the
  // seed changes on every identity change except the registration the wizard
  // itself asked for, so answers never travel between candidates.
  const [intakeSeed, setIntakeSeed] = useState(0);
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

  function toggleRail() {
    setRailExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(RAIL_EXPANDED_KEY, String(next));
      } catch {
        // A browser refusing storage still gets the toggle for this session.
      }
      return next;
    });
  }

  function navigate(view: ShellView) {
    if (!isNavigable(view)) return;
    setActiveView(view);
    setExpertOpen(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('career-main')?.scrollTo({
        top: 0,
        behavior: 'auto',
      });
    });
  }

  function openExpert() {
    setExpertOpen(true);
  }

  function closeExpert() {
    setExpertOpen(false);
  }

  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const resetForAccount = useCallback(
    (nextSession: AuthUser | null) => {
      setActiveView('today');
      if (
        !keepsIntakeAcrossIdentityChange(
          session?.candidateId,
          nextSession?.candidateId,
        )
      ) {
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
      }),
    [onSaveWorkspace],
  );

  return (
    <div
      className={`career-shell ${expertOpen ? 'expert-is-open' : ''}`}
      data-rail={railExpanded ? 'expanded' : 'collapsed'}
      data-testid="career-shell"
    >
      <a className="career-skip-link" href="#career-main">
        К содержанию
      </a>

      <aside
        id="career-rail"
        className="career-rail"
        aria-label="Основная навигация"
        aria-hidden={expertOpen || accountOpen ? true : undefined}
      >
        <button
          className="career-brand-mark"
          type="button"
          onClick={() => navigate('today')}
          aria-label="openqareer, сегодня"
        >
          <BrandMark variant={railExpanded ? 'lockup' : 'mark'} size={30} />
        </button>
        <nav>
          {primaryNavigation.map((item) => (
            <NavigationButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              disabled={!isNavigable(item.id)}
              lockedReason={lockedReason(item.id)}
              onClick={() => navigate(item.id)}
            />
          ))}
        </nav>
        <div className="career-rail-bottom">
          <NavigationButton
            item={{
              id: 'tariffs',
              label: 'Тарифы',
              shortLabel: 'Тарифы',
              icon: Wallet,
            }}
            active={activeView === 'tariffs'}
            disabled={!isNavigable('tariffs')}
            lockedReason={lockedReason('tariffs')}
            onClick={() => navigate('tariffs')}
          />
          {session?.role === 'admin' ? (
            <a className="career-rail-admin" href="/admin">
              <ShieldCheck size={22} />
              <span>Админка</span>
            </a>
          ) : null}
          <button
            className="career-account-button"
            type="button"
            disabled={sessionPending}
            onClick={() => setAccountOpen(true)}
            aria-label="Открыть аккаунт"
          >
            <UserCircle size={24} />
            <span>{session?.username ?? 'Аккаунт'}</span>
          </button>
        </div>
        {/* The handle sits on the rail's own border, which is the edge the
            candidate is already looking at when they wonder what the icons
            mean. Expanding is the only way to read the section names. */}
        <button
          className="career-rail-toggle"
          type="button"
          onClick={toggleRail}
          aria-expanded={railExpanded}
          aria-controls="career-rail"
          aria-label={railExpanded ? 'Свернуть панель' : 'Развернуть панель'}
          title={railExpanded ? 'Свернуть панель' : 'Развернуть панель'}
        >
          {railExpanded ? <CaretLeft size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
        </button>
      </aside>

      {/* Narrow screens hide the rail, so this bar carries the two controls
          that live on it and nowhere else. On desktop it is not rendered at
          all: repeating the logo and offering a second, contextless «Эксперт»
          door was chrome that did nothing (B169 §6, §8). */}
      <header className="career-topbar" aria-hidden={expertOpen || accountOpen ? true : undefined}>
        <button
          className="career-wordmark"
          type="button"
          onClick={() => navigate('today')}
          aria-label="openqareer, сегодня"
        >
          <BrandMark variant="lockup" size={26} />
        </button>
        <div className="career-topbar-actions">
          {isNavigable('tariffs') ? (
            <button
              className="career-mobile-tariffs"
              type="button"
              onClick={() => navigate('tariffs')}
            >
              Тарифы
            </button>
          ) : null}
          {session?.role === 'admin' ? (
            <a href="/admin" className="career-topbar-admin">
              Админка
            </a>
          ) : null}
          <button
            className="career-account-trigger"
            type="button"
            disabled={sessionPending}
            onClick={() => setAccountOpen(true)}
            aria-label="Открыть аккаунт"
          >
            <UserCircle size={20} />
          </button>
        </div>
      </header>

      <main
        id="career-main"
        className="career-main"
        aria-hidden={expertOpen || accountOpen ? true : undefined}
      >
        <AppErrorBoundary>
          {sessionPending && (sessionWaitIsLong || sessionError) ? (
            <section className="career-session-gate" aria-live="polite" aria-busy="true">
              <p className="career-eyebrow">Защита данных</p>
              <h1>Проверяем защищённую сессию</h1>
              <p>Карьерные данные появятся только после проверки аккаунта этого браузера.</p>
              {sessionError ? (
                <>
                  <p className="career-expert-error" role="alert">
                    {sessionError}
                  </p>
                  <button className="career-quiet-button" type="button" onClick={onRetrySession}>
                    Повторить проверку
                  </button>
                </>
              ) : null}
            </section>
          ) : !sessionPending && invalidStorage ? (
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
          {connectionNotice ? (
            <div className="career-connection-notice" role="status">
              <p>{connectionNotice}</p>
              {onDismissConnectionNotice ? (
                <button type="button" onClick={onDismissConnectionNotice}>
                  Понятно
                </button>
              ) : null}
            </div>
          ) : null}

          {intakeVisible ? (
            <CareerIntake
              key={`intake-${intakeSeed}`}
              onComplete={completeIntake}
              hasAccount={Boolean(session)}
              onOpenAccount={() => setAccountOpen(true)}
              onStartedChange={setIntakeStarted}
            />
          ) : null}
          {cabinetSession && !intakeVisible && activeView !== 'tariffs' ? (
            <CareerCabinet
              key={`${cabinetSession.candidateId}:${cabinetSession.displayName ?? ''}:${cabinetSession.email ?? ''}:${cabinetRevision}`}
              view={activeView as CareerCabinetView}
              session={cabinetSession}
              workspace={visibleWorkspace}
              journey={journey}
              onNavigate={navigate}
              onUpdateWorkspace={onUpdateWorkspace}
              onOpenAccount={() => setAccountOpen(true)}
              onOpenExpert={openExpert}
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
          {activeView === 'tariffs' ? <CareerTariffsView onOpenCoach={openExpert} /> : null}
        </AppErrorBoundary>
      </main>

      <nav
        className="career-mobile-nav"
        aria-label="Основная навигация"
        aria-hidden={expertOpen || accountOpen ? true : undefined}
      >
        {primaryNavigation.map((item) => (
          <NavigationButton
            key={item.id}
            item={item}
            active={activeView === item.id}
            disabled={!isNavigable(item.id)}
            lockedReason={lockedReason(item.id)}
            mobile
            onClick={() => navigate(item.id)}
          />
        ))}
      </nav>

      {expertOpen ? (
        <>
          <button
            className="career-expert-scrim"
            type="button"
            onClick={closeExpert}
            aria-label="Закрыть карьерного эксперта"
            aria-hidden="true"
            tabIndex={-1}
          />
          <CareerExpertPanel
            journey={journey}
            marketQuery={visibleWorkspace?.targetDirection}
            initialUser={session ?? null}
            onIdentityChange={resetForAccount}
            onClose={closeExpert}
          />
        </>
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
            onClose={closeAccount}
            onIdentityChange={resetForAccount}
          />
        </>
      ) : null}
    </div>
  );
}

function NavigationButton({
  item,
  active,
  disabled = false,
  lockedReason,
  mobile = false,
  onClick,
}: {
  item: {
    id: ShellView;
    label: string;
    shortLabel: string;
    icon: Icon;
  };
  active: boolean;
  disabled?: boolean;
  lockedReason?: string;
  mobile?: boolean;
  onClick: () => void;
}) {
  const ItemIcon = item.icon;
  return (
    <button
      className={`career-nav-button ${active ? 'is-active' : ''}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={
        disabled && lockedReason ? `${item.label}. ${lockedReason}` : item.label
      }
      title={disabled ? (lockedReason ?? item.label) : item.label}
    >
      <ItemIcon size={22} weight={active ? 'fill' : 'regular'} />
      <span>{mobile ? item.shortLabel : item.label}</span>
    </button>
  );
}
