import { BellSimple, CircleNotch, Sparkle } from '@phosphor-icons/react';
import type { AuthUser } from '../coach/coachApi';
import { NotificationsBell } from '../notifications/NotificationsBell';

interface DesktopCabinetTopbarProps {
  readonly title: string;
  readonly railHint: string | null;
  /** Идёт проверка входа: статус в шапке, как на макете «Вход → скелет». */
  readonly bootStatus?: string | null;
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

type DesktopTopbarActionsProps = Pick<
  DesktopCabinetTopbarProps,
  | 'showNotifications'
  | 'showConsultantButton'
  | 'onOpenConsultant'
  | 'session'
  | 'sessionPending'
  | 'unreadCount'
  | 'onUnreadCountChange'
  | 'onOpenCenter'
  | 'onOpenSettings'
>;

function DesktopTopbarActions(props: DesktopTopbarActionsProps) {
  return (
    <div className="career-desktop-topbar-actions">
      {props.showConsultantButton ? (
        <button
          className="career-notification-bell career-desktop-expert-trigger"
          type="button"
          aria-label="Открыть консультанта"
          onClick={props.onOpenConsultant}
        >
          <Sparkle size={22} aria-hidden="true" />
        </button>
      ) : null}
      {props.showNotifications && props.session?.candidateId && !props.sessionPending ? (
        <NotificationsBell
          unreadCount={props.unreadCount}
          onUnreadCountChange={props.onUnreadCountChange}
          onOpenCenter={props.onOpenCenter}
          onOpenSettings={props.onOpenSettings}
        />
      ) : null}
    </div>
  );
}

export function DesktopCabinetTopbar({
  title,
  railHint,
  bootStatus,
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
      {railHint && !bootStatus ? (
        <span className="career-desktop-topbar-hint" role="status" aria-live="polite">
          {railHint}
        </span>
      ) : null}
      <DesktopTopbarActions
        showNotifications={showNotifications}
        showConsultantButton={showConsultantButton}
        onOpenConsultant={onOpenConsultant}
        session={session}
        sessionPending={sessionPending}
        unreadCount={unreadCount}
        onUnreadCountChange={onUnreadCountChange}
        onOpenCenter={onOpenCenter}
        onOpenSettings={onOpenSettings}
      />
      {bootStatus ? (
        <span className="career-notification-bell career-bootstrap-bell" aria-hidden="true">
          <BellSimple size={22} />
        </span>
      ) : null}
      {bootStatus ? (
        <span
          className="career-desktop-topbar-hint career-bootstrap-status"
          role="status"
          aria-live="polite"
        >
          <CircleNotch size={16} aria-hidden="true" /> {bootStatus}
        </span>
      ) : null}
    </header>
  );
}
