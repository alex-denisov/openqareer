import { useMemo, useState } from 'react';
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
import type { CoachPhase } from '../coach/coachApi';
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

type ShellView =
  | 'today'
  | 'profile'
  | 'career'
  | 'opportunities'
  | 'tariffs';

interface CareerWorkspaceShellProps {
  workspace?: CandidateWorkspace;
  demo?: boolean;
  invalidStorage?: boolean;
  storageError?: string;
  onSaveWorkspace?: (input: WorkspaceInput) => void;
  onUpdateWorkspace?: (workspace: CandidateWorkspace) => void;
  onClearWorkspace?: () => void;
  onOpenDemo?: () => void;
  onExitDemo?: () => void;
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
  demo = false,
  invalidStorage = false,
  storageError,
  onSaveWorkspace = () => undefined,
  onUpdateWorkspace = () => undefined,
  onClearWorkspace = () => undefined,
  onOpenDemo = () => undefined,
  onExitDemo = () => undefined,
}: CareerWorkspaceShellProps) {
  const [activeView, setActiveView] = useState<ShellView>('today');
  const [expertOpen, setExpertOpen] = useState(false);
  const journey = useMemo(
    () => (workspace ? buildCareerJourney(workspace) : undefined),
    [workspace],
  );

  function navigate(view: ShellView) {
    if (!workspace && view !== 'today' && view !== 'tariffs') return;
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
        aria-hidden={expertOpen ? true : undefined}
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
              disabled={!workspace && item.id !== 'today'}
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
            disabled={!workspace}
            onClick={() => navigate('profile')}
            aria-label="Открыть профиль"
          >
            {workspace?.targetDirection.slice(0, 1).toUpperCase() || '?'}
          </button>
        </div>
      </aside>

      <header
        className="career-topbar"
        aria-hidden={expertOpen ? true : undefined}
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
          {demo ? (
            <>
              <span className="career-demo-label">Демо · синтетические данные</span>
              <button
                className="career-demo-exit"
                type="button"
                onClick={onExitDemo}
              >
                Выйти из демо
              </button>
            </>
          ) : null}
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
        </div>
      </header>

      <main
        id="career-main"
        className="career-main"
        aria-hidden={expertOpen ? true : undefined}
      >
        {demo ? (
          <div className="career-demo-banner" role="status">
            <span>Демо · синтетические данные. Изменения не сохраняются.</span>
            <button
              className="career-demo-banner-exit"
              type="button"
              onClick={onExitDemo}
            >
              Выйти из демо
            </button>
          </div>
        ) : null}
        {invalidStorage ? (
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

        {!workspace && activeView === 'today' ? (
          <CareerIntake onComplete={onSaveWorkspace} onOpenDemo={onOpenDemo} />
        ) : null}
        {workspace && journey && activeView === 'today' ? (
          <TodayJourneyView
            workspace={workspace}
            journey={journey}
            onNavigate={navigate}
            onOpenExpert={openExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        ) : null}
        {workspace && journey && activeView === 'profile' ? (
          <ProfileJourneyView
            workspace={workspace}
            journey={journey}
            onNavigate={navigate}
            onOpenExpert={openExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        ) : null}
        {workspace && journey && activeView === 'career' ? (
          <CareerMapView
            workspace={workspace}
            journey={journey}
            onNavigate={navigate}
            onOpenExpert={openExpert}
            onUpdateWorkspace={onUpdateWorkspace}
          />
        ) : null}
        {workspace && journey && activeView === 'opportunities' ? (
          <OpportunitiesView
            workspace={workspace}
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
        aria-hidden={expertOpen ? true : undefined}
      >
        {primaryNavigation.map((item) => (
          <NavigationButton
            key={item.id}
            item={item}
            active={activeView === item.id}
            disabled={!workspace && item.id !== 'today'}
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
