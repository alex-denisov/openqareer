import { useMemo } from 'react';
import type { CandidateNotification } from '../../notifications/notificationsApi';
import { useNotifications } from '../../notifications/useNotifications';
import { Button, Icon, Link, StatusLine } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import {
  groupNotifications,
  notificationAction,
  notificationWhen,
  unreadHeading,
} from './notificationsModel';
import { BlockError, BlockSkeleton } from './parts';

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface RowProps {
  readonly item: CandidateNotification;
  readonly now: Date;
  /** Первое новое событие: его кнопка залита. */
  readonly next: boolean;
  readonly onOpen: (item: CandidateNotification) => void;
}

function NotificationRow({ item, now, next, onOpen }: RowProps) {
  const action = notificationAction(item);
  const unread = item.readAt === null;
  const className = ['notif', 'ev-row2', unread && 'unread', next && 'is-next']
    .filter(Boolean)
    .join(' ');
  return (
    <li className={className}>
      <span className="notif-t">
        {unread ? <span className="vh">Новое. </span> : null}
        {item.title}
      </span>
      <span className="notif-s">{notificationWhen(item.createdAt, now, TIME_ZONE)}</span>
      <Link
        className={next ? 'btn is-sm is-primary' : 'btn is-sm'}
        to={action.path}
        onClick={() => onOpen(item)}
      >
        {action.label}
      </Link>
    </li>
  );
}

type Feed = ReturnType<typeof useNotifications>;

function MoreNotifications({ feed }: { readonly feed: Feed }) {
  return (
    <>
      {feed.nextCursor ? (
        <div className="actions">
          <Button
            variant="quiet"
            icon="down"
            busy={feed.loadingMore}
            onClick={() => void feed.loadMore()}
          >
            Показать ещё 20
          </Button>
        </div>
      ) : null}
      {feed.moreError ? (
        <BlockError text={feed.moreError} onRetry={() => void feed.loadMore()} />
      ) : null}
    </>
  );
}

function NotificationsFeed({ feed, now }: { readonly feed: Feed; readonly now: Date }) {
  const groups = groupNotifications(feed.items, now, TIME_ZONE);
  const nextId = feed.items.find((item) => item.readAt === null)?.id ?? null;
  const open = (item: CandidateNotification) => void feed.markRead(item);

  const group = (title: string, items: readonly CandidateNotification[]) =>
    items.length === 0 ? null : (
      <>
        <h3 className="np-group">{title}</h3>
        <ul>
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              now={now}
              next={item.id === nextId}
              onOpen={open}
            />
          ))}
        </ul>
      </>
    );

  return (
    <>
      {feed.actionError ? <StatusLine state="err" text={feed.actionError} /> : null}
      {feed.status === 'loading' ? <BlockSkeleton label="Загружаем уведомления" rows={4} /> : null}
      {feed.status === 'error' ? (
        <BlockError text={feed.error ?? 'Не удалось загрузить уведомления.'} onRetry={feed.retry} />
      ) : null}
      {feed.status === 'ready' && feed.items.length === 0 ? (
        <p className="np-empty-t">Новых уведомлений нет</p>
      ) : null}
      {feed.status === 'ready' ? group('Сегодня', groups.today) : null}
      {feed.status === 'ready' ? group('Раньше', groups.earlier) : null}
      {feed.status === 'ready' ? <MoreNotifications feed={feed} /> : null}
    </>
  );
}

/** n01b «Все уведомления»: события по дням, действие у каждого, по 20 на порцию. */
export function NotificationsScreen({ node }: { readonly node: B640Node }) {
  const feed = useNotifications();
  useScreenChrome({ bellCount: feed.unreadCount });
  const now = useMemo(() => new Date(), []);
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="col np-full" aria-labelledby="nt-title">
          <div className="list-head">
            <h2 id="nt-title">
              {feed.status === 'ready' ? unreadHeading(feed.unreadCount) : 'Уведомления'}
            </h2>
            {feed.unreadCount > 0 ? (
              <Button
                variant="quiet"
                size="sm"
                icon="check"
                onClick={() => void feed.markAllRead()}
              >
                Отметить всё прочитанным
              </Button>
            ) : null}
            <Link className="icon-btn" to={buildNodePath('n02')} aria-label="Настройки уведомлений">
              <Icon name="settings" />
            </Link>
          </div>
          <NotificationsFeed feed={feed} now={now} />
        </section>
      </div>
    </div>
  );
}
