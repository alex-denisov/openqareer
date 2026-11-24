import { Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Icon } from '../kit/Icon';
import { panelPath } from '../consultant/panelRoute';
import { stageOfNav } from '../consultant/model';
import { subjectOfScreen } from '../consultant/screenSubject';
import type { B640Nav } from '../routes';
import { retryableChunk } from './chunk';
import { ChunkBoundary, ChunkView } from './ChunkBoundary';
import { useShell } from './ShellContext';

const CONSULTANT_PANEL = retryableChunk(() =>
  import('../consultant/ConsultantPanel').then((module) => ({ default: module.ConsultantPanel })),
);

/** Что получает панель уведомлений от оболочки. */
export interface NotificationsPanelProps {
  /** Закрыть панель; фокус возвращается на колокольчик. */
  readonly onClose: () => void;
}

/**
 * Место панели уведомлений (макеты n01 и n01c, `div.np-pop#notif-pop`). Пока здесь `null`,
 * колокольчик ведёт на «Все уведомления»; раздел уведомлений подключает сюда свою панель:
 * `lazy(() => import('../today/NotificationsPanel'))`.
 */
export const NOTIFICATIONS_PANEL: LazyExoticComponent<ComponentType<NotificationsPanelProps>> | null =
  null;

/** Адрес, которым колокольчик связан с панелью (`aria-controls`). */
export const NOTIFICATIONS_PANEL_ID = 'notif-pop';

interface PanelFrameProps {
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Место панели, код которой не загрузился: сетка и «Свернуть» — как у самой панели. */
function PanelFrame({ onClose, children }: PanelFrameProps) {
  return (
    <>
      <div className="backdrop only-mob" aria-hidden="true" onClick={onClose} />
      <aside className="panel-col" role="dialog" aria-label="Консультант">
        <span className="grab" aria-hidden="true" />
        <header className="panel-head ph2">
          <div className="head-acts">
            <button className="icon-btn" type="button" aria-label="Свернуть" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>
        {children}
      </aside>
    </>
  );
}

/** Панели поверх раздела: соседи `main` в сетке `.app`. */
export function ShellPanels({ nav }: { readonly nav: B640Nav | null }) {
  const { panel, match, path, openConsultant, closePanel } = useShell();
  const Notifications = NOTIFICATIONS_PANEL;
  if (!panel) return null;
  return (
    <Suspense fallback={null}>
      {panel.kind === 'consultant' ? (
        <ChunkBoundary
          chunk={CONSULTANT_PANEL}
          resetKey={path}
          frame={(failure) => <PanelFrame onClose={closePanel}>{failure}</PanelFrame>}
        >
          <ChunkView
            chunk={CONSULTANT_PANEL}
            props={{
              view: panel.view,
              stage: stageOfNav(nav),
              subject: subjectOfScreen(match?.params ?? null),
              named: true,
              pathOf: panelPath,
              onView: openConsultant,
              onClose: closePanel,
            }}
          />
        </ChunkBoundary>
      ) : null}
      {panel.kind === 'notifications' && Notifications ? (
        <Notifications onClose={closePanel} />
      ) : null}
    </Suspense>
  );
}
