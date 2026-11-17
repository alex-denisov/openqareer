import type { MouseEvent } from 'react';
import { Icon } from '../kit/Icon';
import type { B640Nav } from '../routes';
import { Link } from './Link';
import { CONSULTANT_PATH, NOTIFICATIONS_PATH, TARIFFS_PATH } from './navigation';
import { NOTIFICATIONS_PANEL, NOTIFICATIONS_PANEL_ID } from './panels';
import { useShell } from './ShellContext';

export interface TopbarProps {
  readonly title: string;
  readonly active: B640Nav | null;
  readonly bellCount: number;
  readonly bellCritical: boolean;
  readonly coachDot: boolean;
  /** Вложенный экран: на 390 слева «Назад» вместо колокольчика. */
  readonly back: { readonly path: string; readonly label: string } | null;
}

/** Нажатие с клавишей-модификатором открывает адрес ссылки в новой вкладке: панель не трогаем. */
function opensNewTab(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

interface BellProps {
  readonly className: string;
  readonly active: boolean;
  readonly count: number;
  readonly critical: boolean;
  /** Колокольчик полосы 1440 и 1176 открывает панель уведомлений, если она подключена. */
  readonly opensPanel?: boolean;
}

/** Атрибуты кнопки панели: нажатие открывает и закрывает её, адрес остаётся запасным. */
function usePanelToggle(enabled: boolean) {
  const { panel, openNotifications, closePanel } = useShell();
  if (!enabled) return {};
  const open = panel?.kind === 'notifications';
  return {
    role: 'button' as const,
    'aria-haspopup': 'dialog' as const,
    'aria-controls': NOTIFICATIONS_PANEL_ID,
    'aria-expanded': open,
    onClick: (event: MouseEvent) => {
      if (opensNewTab(event)) return;
      event.preventDefault();
      if (open) closePanel();
      else openNotifications();
    },
  };
}

function Bell({ className, active, count, critical, opensPanel = false }: BellProps) {
  const label = `Уведомления${count ? `, новых: ${count}` : ''}${critical ? ', есть важное' : ''}`;
  const toggle = usePanelToggle(opensPanel && NOTIFICATIONS_PANEL !== null);
  return (
    <Link
      className={className}
      to={NOTIFICATIONS_PATH}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      {...toggle}
    >
      <Icon name="bell" />
      {count ? (
        <span className={critical ? 'dot num is-crit' : 'dot num'} aria-hidden="true">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function coachLabel(open: boolean, dot: boolean): string {
  if (open) return 'Консультант: свернуть';
  return dot ? 'Консультант: открыть. Есть предложение' : 'Консультант: открыть';
}

/** Кнопка консультанта: адрес остаётся у ссылки (новая вкладка), нажатие открывает панель. */
function useCoachToggle() {
  const { panel, openConsultant, closePanel } = useShell();
  const open = panel?.kind === 'consultant';
  const toggle = (event: MouseEvent) => {
    if (opensNewTab(event)) return;
    event.preventDefault();
    if (open) closePanel();
    else openConsultant();
  };
  return { open, toggle };
}

type BellState = Pick<BellProps, 'active' | 'count' | 'critical'>;

/** Правая часть полосы 1440 и 1176; при открытой панели кнопки «Консультант» нет (макет K1). */
function TopActions({ bell, tariffs }: { readonly bell: BellState; readonly tariffs: boolean }) {
  const coach = useCoachToggle();
  return (
    <div className="top-actions">
      <Bell className="icon-btn bell" {...bell} opensPanel />
      {coach.open ? null : (
        <Link className="btn is-quiet btn-panel" to={CONSULTANT_PATH} onClick={coach.toggle}>
          <Icon name="chat" />
          Консультант
        </Link>
      )}
      <Link
        className="btn is-quiet is-sm"
        to={TARIFFS_PATH}
        aria-current={tariffs ? 'page' : undefined}
      >
        <Icon name="wallet" />
        Тарифы
      </Link>
    </div>
  );
}

function MobCoach({ dot }: { readonly dot: boolean }) {
  const coach = useCoachToggle();
  return (
    <Link
      className="mob-coach"
      to={CONSULTANT_PATH}
      aria-label={coachLabel(coach.open, dot)}
      aria-expanded={coach.open}
      onClick={coach.toggle}
    >
      <Icon name="chat" />
      {dot ? <span className="mob-coach-dot" aria-hidden="true" /> : null}
    </Link>
  );
}

/**
 * Верхняя полоса. 1440 и 1176: заголовок, колокольчик, «Консультант», «Тарифы».
 * 390: «колокольчик или Назад · раздел · консультант», размеры по `--career-ios-*`.
 */
export function Topbar({ title, active, bellCount, bellCritical, coachDot, back }: TopbarProps) {
  const bell: BellState = { active: active === 'bell', count: bellCount, critical: bellCritical };
  return (
    <header className="topbar">
      <div className="mob-left">
        {back ? (
          <Link className="mob-back" to={back.path} aria-label={back.label} title={back.label}>
            <Icon name="back" />
          </Link>
        ) : (
          <Bell className="icon-btn bell mob-bell" {...bell} />
        )}
      </div>
      <h1>{title}</h1>
      <TopActions bell={bell} tariffs={active === 'tariffs'} />
      <MobCoach dot={coachDot} />
    </header>
  );
}
