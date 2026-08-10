import { useCallback, useMemo, useState } from 'react';
import {
  Compass,
  House,
  MapTrifold,
  Path,
  Sparkle,
  UserCircle,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import type { AuthUser, CoachPhase } from '../coach/coachApi';
import { CareerExpertPanel } from '../journey/CareerExpertPanel';
import { CareerIntake } from '../journey/CareerIntake';
import {
  CareerMapView,
  OpportunitiesView,
  ProfileJourneyView,
  TodayJourneyView,
} from '../journey/CareerJourneyViews';
import { buildCareerJourney } from '../journey/careerJourneyEngine';
import type {
  CandidateWorkspace,
  WorkspaceInput,
} from '../workspace/workspaceStorage';
import { CareerTariffsView } from './CareerTariffsView';
import { CareerAccountPanel } from './CareerAccountPanel';

type ShellView =
  | 'today'
  | 'profile'
  | 'career'
  | 'opportunities'
  | 'tariffs';

interface CareerWorkspaceShellProps {
  workspace?: CandidateWorkspace;
  invalidStorage?: boolean;
  storageError?: string;
  onSaveWorkspace?: (input: WorkspaceInput) => void;
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
  career: 'Карьера',
  opportunities: 'Возможности',
  tariffs: 'Тарифы',
};

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
  onSessionChange = () => undefined,
}: CareerWorkspaceShellProps) {
  const [activeView, setActiveView] = useState<ShellView>('today');
  const [expertOpen, setExpertOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const visibleWorkspace = sessionPending ? undefined : workspace;
  const journey = useMemo(
    () => (visibleWorkspace ? buildCareerJourney(visibleWorkspace) : undefined),
    [visibleWorkspace],
  );

  function navigate(view: ShellView) {
    if (!visibleWorkspace && view !== 'today' && view !== 'tariffs') return;
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
  const resetForAccount = useCallback((nextSession: AuthUser | null) => {
    setActiveView('today');
    if (nextSession === null) onClearWorkspace();
    onSessionChange(nextSession);
  }, [onClearWorkspace, onSessionChange]);

  return (
    <div
      className={`career-shell ${expertOpen ? 'expert-is-open' : ''}`}
      data-testid="career-shell"
    >
      <a className="career-skip-link" href="#career-main">
        К содержанию
      </a>

      <aside
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
          <MapTrifold size={25} weight="duotone" />
        </button>
        <nav>
          {primaryNavigation.map((item) => (
            <NavigationButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              disabled={!visibleWorkspace && item.id !== 'today'}
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
            onClick={() => navigate('tariffs')}
          />
          <button
            className="career-avatar-button"
            type="button"
            disabled={sessionPending}
            onClick={() => setAccountOpen(true)}
            aria-label="Открыть аккаунт"
          >
            {session?.username.slice(0, 1).toUpperCase()
              || visibleWorkspace?.targetDirection.slice(0, 1).toUpperCase()
              || '?'}
          </button>
        </div>
      </aside>

      <header
        className="career-topbar"
        aria-hidden={expertOpen || accountOpen ? true : undefined}
      >
        <button
          className="career-wordmark"
          type="button"
          onClick={() => navigate('today')}
        >
          <span>open</span>qareer
        </button>
        <span className="career-page-name">{pageNames[activeView]}</span>
        <div className="career-topbar-actions">
          <button
            className="career-mobile-tariffs"
            type="button"
            onClick={() => navigate('tariffs')}
          >
            Тарифы
          </button>
          <button
            className="career-expert-trigger"
            type="button"
            onClick={() => setExpertOpen((current) => !current)}
            aria-expanded={expertOpen}
          >
            <Sparkle size={18} weight="fill" />
            Эксперт
          </button>
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
        {sessionPending ? (
          <section className="career-session-gate" aria-live="polite" aria-busy="true">
            <p className="career-eyebrow">Защита данных</p>
            <h1>Проверяем защищённую сессию</h1>
            <p>
              Карьерные данные появятся только после проверки аккаунта этого
              браузера.
            </p>
            {sessionError ? (
              <>
                <p className="career-expert-error" role="alert">{sessionError}</p>
                <button className="career-quiet-button" type="button" onClick={onRetrySession}>
                  Повторить проверку
                </button>
              </>
            ) : null}
          </section>
        ) : invalidStorage ? (
          <div className="career-storage-warning" role="alert">
            <div>
              <strong>Сохранённый профиль не удалось прочитать</strong>
              <p>Удалите повреждённую локальную запись и начните заново.</p>
            </div>
            <button type="button" onClick={onClearWorkspace}>Очистить запись</button>
          </div>
        ) : null}
        {storageError ? (
          <p className="career-storage-warning" role="alert">{storageError}</p>
        ) : null}

        {!sessionPending && !visibleWorkspace && activeView === 'today' ? (
          <CareerIntake
            key={session?.candidateId ?? 'anonymous'}
            onComplete={onSaveWorkspace}
          />
        ) : null}
        {visibleWorkspace && journey && activeView === 'today' ? (
          <TodayJourneyView
            workspace={visibleWorkspace}
            journey={journey}
            onNavigate={navigate}
            onOpenExpert={openExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        ) : null}
        {visibleWorkspace && journey && activeView === 'profile' ? (
          <ProfileJourneyView
            workspace={visibleWorkspace}
            journey={journey}
            onNavigate={navigate}
            onOpenExpert={openExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        ) : null}
        {visibleWorkspace && journey && activeView === 'career' ? (
          <CareerMapView
            workspace={visibleWorkspace}
            journey={journey}
            onNavigate={navigate}
            onOpenExpert={openExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        ) : null}
        {visibleWorkspace && journey && activeView === 'opportunities' ? (
          <OpportunitiesView
            workspace={visibleWorkspace}
            journey={journey}
            onNavigate={navigate}
            onOpenExpert={openExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        ) : null}
        {activeView === 'tariffs' ? (
          <CareerTariffsView onOpenCoach={openExpert} />
        ) : null}
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
            disabled={!visibleWorkspace && item.id !== 'today'}
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
            phase={phaseFor(activeView)}
            onClose={closeExpert}
          />
        </>
      ) : null}
      {accountOpen ? (
        <>
          <button className="career-expert-scrim" type="button" onClick={closeAccount} aria-label="Закрыть аккаунт" aria-hidden="true" tabIndex={-1} />
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
      aria-label={item.label}
      title={disabled ? 'Сначала соберите карьерную картину' : item.label}
    >
      <ItemIcon size={22} weight={active ? 'fill' : 'regular'} />
      <span>{mobile ? item.shortLabel : item.label}</span>
    </button>
  );
}

function phaseFor(view: ShellView): CoachPhase {
  if (view === 'profile') return 'evidence';
  if (view === 'career') return 'role';
  if (view === 'opportunities') return 'targeting';
  return 'discovery';
}
