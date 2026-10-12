import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { GearSix } from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import { apiErrorMessage } from '../coach/apiClient';
import { listNotifications, markAllNotificationsRead, type CandidateNotification } from './notificationsApi';
import { BellGlyph, NotificationGlyph } from './NotificationGlyph';
import { notificationDateLabel } from './notificationPresentation';

interface NotificationsBellProps {
  readonly unreadCount: number;
  readonly onUnreadCountChange: (count: number) => void;
  readonly onOpenCenter: (notificationId?: string) => void;
  readonly onOpenSettings: () => void;
}

type BellState = 'loading' | 'ready' | 'error';

interface BellData {
  readonly items: readonly CandidateNotification[];
  readonly state: BellState;
  readonly error: string | null;
  readonly busy: boolean;
}

type SetBellData = Dispatch<SetStateAction<BellData>>;

async function loadBellData(
  signal: AbortSignal,
  onUnreadCountChange: (count: number) => void,
  setData: SetBellData,
): Promise<void> {
  try {
    const page = await listNotifications({ limit: 5, signal });
    if (signal.aborted) return;
    setData({ items: page.items, state: 'ready', error: null, busy: false });
    onUnreadCountChange(page.unreadCount);
  } catch (reason) {
    if (signal.aborted) return;
    setData((current) => ({ ...current, state: 'error', error: apiErrorMessage(reason, 'Не удалось загрузить уведомления.') }));
  }
}

async function markBellItemsRead(
  unreadCount: number,
  onUnreadCountChange: (count: number) => void,
  setData: SetBellData,
): Promise<void> {
  if (unreadCount === 0) return;
  setData((current) => ({ ...current, busy: true, error: null }));
  try {
    await markAllNotificationsRead();
    const readAt = new Date().toISOString();
    setData((current) => ({ ...current, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })), busy: false }));
    onUnreadCountChange(0);
  } catch (reason) {
    setData((current) => ({ ...current, busy: false, error: apiErrorMessage(reason, 'Не удалось прочитать все уведомления.') }));
  }
}

function useBellData(onUnreadCountChange: (count: number) => void) {
  const [data, setData] = useState<BellData>({ items: [], state: 'loading', error: null, busy: false });
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData((current) => ({ ...current, state: 'loading', error: null }));
    void loadBellData(controller.signal, onUnreadCountChange, setData);
    return () => controller.abort();
  }, [onUnreadCountChange, reloadToken]);
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);
  return { ...data, refresh, setData };
}

function useBellPopover(onOpenCenter: (notificationId?: string) => void, refresh: () => void) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => setOpen(false), []);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useEscapeLayer(close, open);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [dismiss, open]);
  const toggle = useCallback(() => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setOpen(false);
      onOpenCenter();
      return;
    }
    if (open) setOpen(false);
    else {
      setOpen(true);
      refresh();
    }
  }, [onOpenCenter, open, refresh]);
  return { open, setOpen, rootRef, triggerRef, dismiss, toggle };
}

export function NotificationsBell(props: NotificationsBellProps) {
  const data = useBellData(props.onUnreadCountChange);
  const popover = useBellPopover(props.onOpenCenter, data.refresh);
  const badge = props.unreadCount > 99 ? '99+' : String(props.unreadCount);
  const label = props.unreadCount > 0
    ? `Центр уведомлений, ${props.unreadCount} непрочитанных`
    : 'Центр уведомлений';
  return (
    <div className="career-notification-bell-anchor" ref={popover.rootRef}>
      <button
        ref={popover.triggerRef}
        className="career-notification-bell"
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        aria-controls="career-notification-popover"
        aria-busy={data.state === 'loading'}
        onClick={popover.toggle}
      >
        <BellGlyph />
        {props.unreadCount > 0 ? <span className="career-notification-badge" aria-hidden="true">{badge}</span> : null}
      </button>
      {popover.open ? (
        <NotificationsPopover
          items={data.items}
          state={data.state}
          error={data.error}
          busy={data.busy}
          unreadCount={props.unreadCount}
          onRetry={data.refresh}
          onReadAll={() => void markBellItemsRead(props.unreadCount, props.onUnreadCountChange, data.setData)}
          onOpenSettings={() => {
            popover.dismiss();
            props.onOpenSettings();
          }}
          onOpenNotification={(id) => {
            popover.dismiss();
            props.onOpenCenter(id);
          }}
          onOpenCenter={() => {
            popover.dismiss();
            props.onOpenCenter();
          }}
        />
      ) : null}
    </div>
  );
}

function NotificationsPopover({
  items,
  state,
  error,
  busy,
  unreadCount,
  onRetry,
  onReadAll,
  onOpenSettings,
  onOpenNotification,
  onOpenCenter,
}: {
  readonly items: readonly CandidateNotification[];
  readonly state: BellState;
  readonly error: string | null;
  readonly busy: boolean;
  readonly unreadCount: number;
  readonly onRetry: () => void;
  readonly onReadAll: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenNotification: (id: string) => void;
  readonly onOpenCenter: () => void;
}) {
  return (
    <section className="career-notification-popover" id="career-notification-popover" role="dialog" aria-label="Уведомления">
      <header className="career-notification-popover-header">
        <div>
          <h2>Уведомления</h2>
          <p>Непрочитанные {unreadCount}</p>
        </div>
        <button className="career-btn is-ghost is-sm" type="button" disabled={busy || unreadCount === 0} onClick={onReadAll}>
          {busy ? 'Сохраняем…' : 'Прочитать все'}
        </button>
        <button className="career-btn is-ghost is-icon" type="button" aria-label="Настроить уведомления" onClick={onOpenSettings}>
          <GearSix className="career-notification-icon" aria-hidden="true" />
        </button>
      </header>
      <NotificationsPopoverContent state={state} error={error} items={items} onRetry={onRetry} onOpenNotification={onOpenNotification} />
      <footer className="career-notification-popover-footer">
        <a className="career-btn is-ghost" href="#career-main" onClick={(event) => {
          event.preventDefault();
          onOpenCenter();
        }}>Все уведомления</a>
      </footer>
    </section>
  );
}

function NotificationsPopoverContent({
  state,
  error,
  items,
  onRetry,
  onOpenNotification,
}: {
  readonly state: BellState;
  readonly error: string | null;
  readonly items: readonly CandidateNotification[];
  readonly onRetry: () => void;
  readonly onOpenNotification: (id: string) => void;
}) {
  if (state === 'loading') return <p className="career-notification-popover-status" role="status" aria-busy="true">Загружаем уведомления…</p>;
  if (state === 'error') return <NotificationLoadError message={error} onRetry={onRetry} />;
  if (items.length === 0) return <p className="career-notification-popover-status">Новых уведомлений нет.</p>;
  return (
    <ul className="career-notification-popover-list">
      {items.map((item) => (
        <li key={item.id}>
          <button className={`career-notification-popover-row${item.readAt ? '' : ' is-unread'}`} type="button" onClick={() => onOpenNotification(item.id)}>
            <NotificationGlyph kind={item.kind} />
            <span className="career-notification-row-copy">
              <strong>{item.title}</strong>
              <small>{notificationDateLabel(item.createdAt)}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NotificationLoadError({ message, onRetry }: { readonly message: string | null; readonly onRetry: () => void }) {
  return (
    <div className="career-notification-load-error" role="alert">
      <p>{message ?? 'Не удалось загрузить уведомления.'}</p>
      <button className="career-btn is-ghost" type="button" onClick={onRetry}>Повторить</button>
    </div>
  );
}
