import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { panelPath } from '../consultant/panelRoute';
import { stageOfNav } from '../consultant/model';
import type { B640Nav } from '../routes';
import { useShell } from './ShellContext';

const ConsultantPanel = lazy(() =>
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

/** Панели поверх раздела: соседи `main` в сетке `.app`. */
export function ShellPanels({ nav }: { readonly nav: B640Nav | null }) {
  const { panel, openConsultant, closePanel } = useShell();
  const Notifications = NOTIFICATIONS_PANEL;
  if (!panel) return null;
  return (
    <Suspense fallback={null}>
      {panel.kind === 'consultant' ? (
        <ConsultantPanel
          view={panel.view}
          stage={stageOfNav(nav)}
          named
          pathOf={panelPath}
          onView={openConsultant}
          onClose={closePanel}
        />
      ) : null}
      {panel.kind === 'notifications' && Notifications ? (
        <Notifications onClose={closePanel} />
      ) : null}
    </Suspense>
  );
}
