import { useMemo } from 'react';
import { Button, Icon, Link, StatusLine } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import type { B640Notification } from './b640NotificationsApi';
import { FEED_FILTERS, feedAction, feedSubtitle, pinnedAction, pinnedTitle } from './feedModel';
import { groupNotifications, unreadHeading } from './notificationsModel';
import { BlockError, BlockSkeleton } from './parts';
import { LOAD_ERROR, useFeed, type Feed } from './useFeed';

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface RowProps {
  readonly item: B640Notification;
  readonly now: Date;
  /** Первое новое событие: его кнопка залита. */
  readonly next: boolean;
  readonly onOpen: (item: B640Notification) => void;
}

function NotificationRow({ item, now, next, onOpen }: RowProps) {
  const action = feedAction(item);
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
      <span className="notif-s">{feedSubtitle(item, now, TIME_ZONE)}</span>
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

/** Важные непрочитанные события сверху: одно действие у каждого. */
function Pinned({ feed }: { readonly feed: Feed }) {
  if (feed.status !== 'ready' || feed.pinned.length === 0) return null;
  return (
    <ul className="np-crit" aria-label="Важно: нужно ваше действие">
      {feed.pinned.map((item, index) => {
        const action = pinnedAction(item);
        return (
          <li className="np-crit-i is-one" key={item.id}>
            {index === 0 ? <span className="np-crit-l">Важно</span> : null}
            <span className="np-crit-t">{pinnedTitle(item)}</span>
            <Link className="btn is-sm" to={action.path} onClick={() => void feed.markRead(item)}>
              {action.icon ? <Icon name={action.icon} /> : null}
              {action.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Filters({ feed }: { readonly feed: Feed }) {
  return (
    <div className="chips" role="group" aria-label="Показать">
      {FEED_FILTERS.map((filter) => (
        <button
          className="chip"
          type="button"
          key={filter.value}
          aria-pressed={feed.filter === filter.value}
          onClick={() => feed.setFilter(filter.value)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

function MoreNotifications({ feed }: { readonly feed: Feed }) {
  if (!feed.nextCursor) return null;
  return (
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
  );
}

function Group(props: {
  readonly title: string;
  readonly items: readonly B640Notification[];
  readonly now: Date;
  readonly nextId: string | null;
  readonly onOpen: (item: B640Notification) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <>
      <h3 className="np-group">{props.title}</h3>
      <ul>
        {props.items.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            now={props.now}
            next={item.id === props.nextId}
            onOpen={props.onOpen}
          />
        ))}
      </ul>
    </>
  );
}

function NotificationsFeed({ feed, now }: { readonly feed: Feed; readonly now: Date }) {
  if (feed.status === 'loading') return <BlockSkeleton label="Загружаем уведомления" rows={4} />;
  if (feed.status === 'error') return <BlockError text={LOAD_ERROR} onRetry={feed.retry} />;
  const groups = groupNotifications(feed.items, now, TIME_ZONE);
  const nextId = feed.items.find((item) => item.readAt === null)?.id ?? null;
  const open = (item: B640Notification) => void feed.markRead(item);
  const empty = feed.items.length === 0 && feed.pinned.length === 0;
  return (
    <>
      {empty ? <p className="np-empty-t">Новых уведомлений нет</p> : null}
      <Group title="Сегодня" items={groups.today} now={now} nextId={nextId} onOpen={open} />
      <Group title="Раньше" items={groups.earlier} now={now} nextId={nextId} onOpen={open} />
      <MoreNotifications feed={feed} />
    </>
  );
}

/** n01b «Все уведомления»: важное сверху, фильтр по категории, события по дням. */
export function NotificationsScreen({ node }: { readonly node: B640Node }) {
  const feed = useFeed();
  useScreenChrome({
    bellCount: feed.unreadCount,
    bellCritical: feed.status === 'ready' && feed.pinned.length > 0,
  });
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
          {feed.actionError ? <StatusLine state="err" text={feed.actionError} /> : null}
          <Pinned feed={feed} />
          <Filters feed={feed} />
          <NotificationsFeed feed={feed} now={now} />
        </section>
      </div>
    </div>
  );
}
