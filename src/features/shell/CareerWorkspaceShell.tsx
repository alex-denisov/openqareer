import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { CaretLeft, CaretRight, ShieldCheck } from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import {
  SearchIcon,
  VacanciesIcon,
  ProfileIcon,
  TariffsIcon,
  type SectionIconProps,
} from './sectionIcons';
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
import { CURRENT_PLAN } from './tariffPackages';
import { initialsFor } from './accountIdentity';
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
  onSaveWorkspace?: (input: WorkspaceInput) => void | Promise<void>;
  onUpdateWorkspace?: (workspace: CandidateWorkspace) => void;
  onClearWorkspace?: () => void;
  session?: AuthUser | null;
  sessionPending?: boolean;
  sessionError?: string;
  onRetrySession?: () => void;
  onOpenLogin?: () => void;
  onSessionChange?: (session: AuthUser | null) => void;
}

type SectionIcon = (props: SectionIconProps) => ReactElement;

const primaryNavigation: Array<{
  id: Exclude<ShellView, 'tariffs'>;
  label: string;
  icon: SectionIcon;
}> = [
  { id: 'today', label: 'Главная', icon: ProfileIcon },
  { id: 'career', label: 'Поиск', icon: SearchIcon },
  {
    id: 'opportunities',
    label: 'Вакансии',
    icon: VacanciesIcon,
  },
];

/**
 * В рельсе три раздела — ровно те, что в макете «Пульт»: «Главная», «Поиск»,
 * «Вакансии». Раздела «Резюме» в макете нет; мастер-резюме остаётся доступен
 * из «Портфолио» на «Главной», где ему и место (B179).
 */
const pageNames: Record<ShellView, string> = {
  today: 'Главная',
  profile: 'Главная',
  resume: 'Резюме',
  career: 'Поиск',
  opportunities: 'Вакансии',
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
  onSaveWorkspace = () => undefined,
  onUpdateWorkspace = () => undefined,
  onClearWorkspace = () => undefined,
  session,
  sessionPending = false,
  sessionError,
  onRetrySession = () => undefined,
  onOpenLogin = () => undefined,
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
  // The wizard's import keeps running after the cabinet mounts; «Сегодня» must
  // not print a confident zero over it (B160 §3).
  const [importing, setImporting] = useState(false);
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
        setImporting,
      }),
    [onSaveWorkspace],
  );

  const planName = CURRENT_PLAN.name;
  const accountInitials = initialsFor(
    session?.displayName ?? session?.username ?? null,
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
          aria-label="openqareer, главная"
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
          {/* «Пульт»: тариф — не пункт меню, а карточка текущего плана. Строка
              меню читалась как ещё один раздел кабинета и стояла в одном ряду
              с «Карьерой». */}
          <button
            className={`career-plan-card ${activeView === 'tariffs' ? 'is-active' : ''}`}
            type="button"
            disabled={!isNavigable('tariffs')}
            onClick={() => navigate('tariffs')}
            aria-current={activeView === 'tariffs' ? 'page' : undefined}
            aria-label={
              !isNavigable('tariffs') && lockedReason('tariffs')
                ? `Тарифы. ${lockedReason('tariffs')}`
                : `Тарифы, текущий план «${planName}»`
            }
            title={
              !isNavigable('tariffs')
                ? (lockedReason('tariffs') ?? 'Тарифы')
                : 'Тарифы'
            }
          >
            <span className="career-plan-facet">
              <TariffsIcon size={18} active={activeView === 'tariffs'} />
            </span>
            <span className="career-plan-text">
              <b>Тарифы</b>
              <span>план «{planName}»</span>
            </span>
          </button>
          {session?.role === 'admin' ? (
            <a className="career-rail-admin" href="/admin">
              <ShieldCheck size={22} />
              <span>Админка</span>
            </a>
          ) : null}
          {/* Отделён линией: это не раздел, а вы. */}
          <button
            className="career-account-button"
            type="button"
            disabled={sessionPending}
            onClick={() => setAccountOpen(true)}
            aria-label="Открыть аккаунт"
          >
            <span className="career-rail-avatar" aria-hidden="true">
              {accountInitials}
            </span>
            <span className="career-account-identity">
              <b>{session?.displayName ?? session?.username ?? 'Аккаунт'}</b>
              <span>{session?.email ?? session?.username ?? 'Войти'}</span>
            </span>
          </button>
        </div>
        {/* Ручка сидит на кромке рельса, как разделитель панелей: прежняя
            строка «Свернуть» занимала пункт меню и читалась как раздел. */}
        <button
          className="career-rail-toggle"
          type="button"
          onClick={toggleRail}
          aria-expanded={railExpanded}
          aria-controls="career-rail"
          aria-label={railExpanded ? 'Свернуть панель' : 'Развернуть панель'}
          title={railExpanded ? 'Свернуть панель' : 'Развернуть панель'}
        >
          {railExpanded ? <CaretLeft size={12} /> : <CaretRight size={12} />}
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
          aria-label="openqareer, главная"
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
            <span className="career-rail-avatar" aria-hidden="true">
              {accountInitials}
            </span>
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
                  <div className="career-session-gate-actions">
                    <button className="career-quiet-button" type="button" onClick={onRetrySession}>
                      Повторить проверку
                    </button>
                    <button className="career-quiet-button" type="button" onClick={onOpenLogin}>
                      Открыть вход
                    </button>
                  </div>
                </>
              ) : sessionWaitIsLong ? (
                <div className="career-session-gate-actions">
                  <button className="career-quiet-button" type="button" onClick={onRetrySession}>
                    Повторить проверку
                  </button>
                  <button className="career-quiet-button" type="button" onClick={onOpenLogin}>
                    Открыть вход
                  </button>
                </div>
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
              importing={importing}
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
  onClick,
}: {
  item: {
    id: ShellView;
    label: string;
    icon: SectionIcon;
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
      <ItemIcon size={22} active={active} />
      <span>{item.label}</span>
    </button>
  );
}
