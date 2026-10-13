import { useCallback, useEffect, useMemo, useState } from 'react';
import { CaretLeft, CheckCircle, GearSix } from '@phosphor-icons/react';
import type { ShellSection } from '../shell/shellNavigation';
import { apiErrorMessage } from '../coach/apiClient';
import {
  notificationDateLabel,
  notificationDescription,
  notificationPrimaryLabel,
  notificationSecondaryLabel,
  notificationSource,
  notificationTargetView,
  isNotificationToday,
} from './notificationPresentation';
import { NotificationGlyph } from './NotificationGlyph';
import { scheduleInterviewReminder, scheduleRecruiterReminder } from './notificationActions';
import { useNotifications } from './useNotifications';
import type { CandidateNotification } from './notificationsApi';
import './notifications.css';

type NotificationFilter = 'all' | 'unread';
type ReminderState = 'idle' | 'saving' | 'saved' | 'error';

interface NotificationsScreenProps {
  readonly initialSelectedId?: string | null;
  readonly onUnreadCountChange: (count: number) => void;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onOpenSettings: () => void;
}

interface NotificationGroups {
  readonly today: readonly CandidateNotification[];
  readonly earlier: readonly CandidateNotification[];
}

interface NotificationsScreenModel {
  readonly page: ReturnType<typeof useNotifications>;
  readonly selectedId: string | null;
  readonly clearSelection: () => void;
  readonly selectedItem?: CandidateNotification;
  readonly filter: NotificationFilter;
  readonly setFilter: (filter: NotificationFilter) => void;
  readonly filteredItems: readonly CandidateNotification[];
  readonly groups: NotificationGroups;
  readonly unreadEmpty: boolean;
  readonly reminderState: ReminderState;
  readonly reminderMessage: string | null;
  readonly handleSelect: (item: CandidateNotification) => void;
  readonly handleReminder: (item: CandidateNotification) => Promise<void>;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onOpenSettings: () => void;
}

function groupNotifications(items: readonly CandidateNotification[]): NotificationGroups {
  return items.reduce<NotificationGroups>((groups, item) => {
    if (isNotificationToday(item.createdAt)) {
      return { ...groups, today: [...groups.today, item] };
    }
    return { ...groups, earlier: [...groups.earlier, item] };
  }, { today: [], earlier: [] });
}

function useNotificationSelection(initialSelectedId?: string | null) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  useEffect(() => {
    setSelectedId(initialSelectedId ?? null);
  }, [initialSelectedId]);
  return { selectedId, setSelectedId };
}

function reminderError(reason: unknown): string {
  return apiErrorMessage(reason, 'Не удалось установить напоминание.');
}

async function saveReminder(item: CandidateNotification): Promise<void> {
  if (item.kind === 'interview_reminder') return scheduleInterviewReminder(item);
  if (item.kind === 'employer_reply') return scheduleRecruiterReminder(item);
}

function useReminderAction() {
  const [state, setState] = useState<ReminderState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const reset = useCallback(() => {
    setState('idle');
    setMessage(null);
  }, []);
  const handleReminder = useCallback(async (item: CandidateNotification) => {
    setState('saving');
    setMessage(null);
    try {
      await saveReminder(item);
      setState('saved');
      setMessage('Напоминание установлено в отклике.');
    } catch (reason) {
      setState('error');
      setMessage(reminderError(reason));
    }
  }, []);
  return { state, message, handleReminder, reset };
}

function useNotificationsScreenModel(props: NotificationsScreenProps): NotificationsScreenModel {
  const page = useNotifications(props.onUnreadCountChange);
  const selection = useNotificationSelection(props.initialSelectedId);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const reminder = useReminderAction();
  const resetReminder = reminder.reset;
  const setSelectedId = selection.setSelectedId;
  const markRead = page.markRead;
  const filteredItems = useMemo(
    () => filter === 'unread' ? page.items.filter((item) => !item.readAt) : page.items,
    [filter, page.items],
  );
  const groups = useMemo(() => groupNotifications(filteredItems), [filteredItems]);
  const selectedItem = page.items.find((item) => item.id === selection.selectedId) ?? page.items[0];

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)').matches;
    if (page.status === 'ready' && desktop && !selection.selectedId && page.items[0]) {
      setSelectedId(page.items[0].id);
    }
  }, [page.items, page.status, selection.selectedId, setSelectedId]);

  const handleSelect = useCallback((item: CandidateNotification) => {
    resetReminder();
    setSelectedId(item.id);
  }, [resetReminder, setSelectedId]);
  useEffect(() => {
    const selected = page.items.find((item) => item.id === selection.selectedId);
    if (selected && !selected.readAt) void markRead(selected);
  }, [markRead, page.items, selection.selectedId]);
  const unreadEmpty = filter === 'unread' && filteredItems.length === 0 && page.status === 'ready';
  return {
    page,
    selectedId: selection.selectedId,
    clearSelection: () => selection.setSelectedId(null),
    selectedItem,
    filter,
    setFilter,
    filteredItems,
    groups,
    unreadEmpty,
    reminderState: reminder.state,
    reminderMessage: reminder.message,
    handleSelect,
    handleReminder: reminder.handleReminder,
    onNavigate: props.onNavigate,
    onOpenSettings: props.onOpenSettings,
  };
}

export function NotificationsScreen(props: NotificationsScreenProps) {
  const model = useNotificationsScreenModel(props);
  return (
    <section className="career-notifications-page" data-mobile-selected={model.selectedId ? 'true' : 'false'} aria-label="Центр уведомлений">
      <NotificationHeading model={model} />
      <NotificationStatus model={model} />
      {model.page.status === 'ready' ? <NotificationCenterContent model={model} /> : null}
    </section>
  );
}

function NotificationHeading({ model }: { readonly model: NotificationsScreenModel }) {
  return (
    <header className="career-notification-heading">
      <div>
        <h1>Уведомления</h1>
        <p>Непрочитанные <strong>{model.page.unreadCount}</strong></p>
      </div>
      <div className="career-notification-heading-actions">
        <button className="career-btn is-ghost career-notification-settings-button" type="button" onClick={model.onOpenSettings}>
          <GearSix className="career-notification-icon" aria-hidden="true" />
          <span>Настроить уведомления</span>
        </button>
        <button className="career-btn is-ghost career-notification-read-all-button" type="button" disabled={model.page.unreadCount === 0 || model.page.status !== 'ready'} onClick={() => void model.page.markAllRead()}>
          <CheckCircle className="career-notification-icon" aria-hidden="true" />
          <span>Прочитать все</span>
        </button>
      </div>
    </header>
  );
}

function NotificationStatus({ model }: { readonly model: NotificationsScreenModel }) {
  return (
    <>
      {model.page.actionError ? <p className="career-notification-action-error" role="alert">{model.page.actionError}</p> : null}
      {model.page.status === 'loading' ? <NotificationLoading /> : null}
      {model.page.status === 'error' ? <NotificationPageError message={model.page.error} onRetry={model.page.retry} /> : null}
    </>
  );
}

function NotificationCenterContent({ model }: { readonly model: NotificationsScreenModel }) {
  return (
    <div className="career-notification-layout">
      <section className="career-notification-list-panel" aria-label="Список уведомлений">
        <NotificationFilterTabs filter={model.filter} onChange={model.setFilter} />
        {model.filteredItems.length === 0 ? <NotificationEmpty unreadOnly={model.unreadEmpty} /> : (
          <NotificationGroupsView groups={model.groups} selectedId={model.selectedId} onSelect={model.handleSelect} />
        )}
        <NotificationLoadMore nextCursor={model.page.nextCursor} loading={model.page.loadingMore} error={model.page.moreError} onLoadMore={model.page.loadMore} />
      </section>
      <SelectedNotificationDetail model={model} />
    </div>
  );
}

function SelectedNotificationDetail({ model }: { readonly model: NotificationsScreenModel }) {
  const item = model.selectedItem;
  if (!item) return null;
  return (
    <NotificationDetail
      item={item}
      reminderState={model.reminderState}
      reminderMessage={model.reminderMessage}
      onBack={model.clearSelection}
      onNavigate={model.onNavigate}
      onReminder={() => void model.handleReminder(item)}
    />
  );
}

function NotificationFilterTabs({ filter, onChange }: {
  readonly filter: NotificationFilter;
  readonly onChange: (value: NotificationFilter) => void;
}) {
  return (
    <div className="career-notification-filters" role="tablist" aria-label="Фильтр уведомлений">
      <button role="tab" type="button" aria-selected={filter === 'all'} onClick={() => onChange('all')}>Все</button>
      <button role="tab" type="button" aria-selected={filter === 'unread'} onClick={() => onChange('unread')}>Непрочитанные</button>
    </div>
  );
}

function NotificationGroupsView({ groups, selectedId, onSelect }: {
  readonly groups: NotificationGroups;
  readonly selectedId: string | null;
  readonly onSelect: (item: CandidateNotification) => void;
}) {
  return (
    <div className="career-notification-groups">
      {groups.today.length ? <NotificationGroup title="Сегодня" items={groups.today} selectedId={selectedId} onSelect={onSelect} /> : null}
      {groups.earlier.length ? <NotificationGroup title="Раньше" items={groups.earlier} selectedId={selectedId} onSelect={onSelect} /> : null}
    </div>
  );
}

function NotificationGroup({ title, items, selectedId, onSelect }: {
  readonly title: string;
  readonly items: readonly CandidateNotification[];
  readonly selectedId: string | null;
  readonly onSelect: (item: CandidateNotification) => void;
}) {
  return (
    <section className="career-notification-group" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`career-notification-list-row${item.readAt ? '' : ' is-unread'}${selectedId === item.id ? ' is-selected' : ''}`}
              type="button"
              aria-label={`${item.title}${item.readAt ? '' : ', не прочитано'}`}
              aria-current={selectedId === item.id ? 'true' : undefined}
              onClick={() => onSelect(item)}
            >
              <NotificationGlyph kind={item.kind} />
              <span className="career-notification-list-copy">
                <strong>{item.title}</strong>
                <small>{notificationDateLabel(item.createdAt)}</small>
              </span>
              {!item.readAt ? <span className="career-notification-unread-dot" aria-label="Не прочитано" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotificationDetail({ item, reminderState, reminderMessage, onBack, onNavigate, onReminder }: {
  readonly item: CandidateNotification;
  readonly reminderState: ReminderState;
  readonly reminderMessage: string | null;
  readonly onBack: () => void;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onReminder: () => void;
}) {
  const secondaryLabel = notificationSecondaryLabel(item);
  return (
    <article className="career-notification-detail" data-mobile-detail="true">
      <div className="career-notification-detail-topline">
        <button className="career-notification-back" type="button" aria-label="Назад" onClick={onBack}>
          <CaretLeft className="career-notification-icon" aria-hidden="true" />
        </button>
        <h1 className="career-notification-mobile-title">Уведомление</h1>
        <span className="career-notification-date">{notificationDateLabel(item.createdAt)}</span>
      </div>
      <div className="career-notification-detail-content">
        <div className="career-notification-detail-icon"><NotificationGlyph kind={item.kind} /></div>
        <div className="career-notification-detail-state">{item.readAt ? 'Прочитано' : 'Не прочитано'}</div>
        <h2>{item.title}</h2>
        <p>{notificationDescription(item.kind)}</p>
        <dl>
          <div><dt>Источник</dt><dd>{notificationSource(item.kind)}</dd></div>
          <div><dt>Дата</dt><dd>{notificationDateLabel(item.createdAt)}</dd></div>
        </dl>
        <div className="career-notification-detail-actions">
          <button className="career-btn career-btn-primary" type="button" onClick={() => onNavigate(notificationTargetView(item))}>
            {notificationPrimaryLabel(item)}
          </button>
          {secondaryLabel ? (
            <button className="career-btn is-ghost" type="button" disabled={reminderState === 'saving' || reminderState === 'saved'} onClick={onReminder}>
              {reminderState === 'saving' ? 'Сохраняем…' : secondaryLabel}
            </button>
          ) : null}
        </div>
        {reminderMessage ? <p className={`career-notification-reminder-message is-${reminderState}`} role={reminderState === 'error' ? 'alert' : 'status'}>{reminderMessage}</p> : null}
      </div>
    </article>
  );
}

function NotificationLoading() {
  return (
    <div className="career-notification-loading" role="status" aria-busy="true">
      <p>Загружаем уведомления…</p>
      <div className="career-notification-loading-row" aria-hidden="true" />
      <div className="career-notification-loading-row" aria-hidden="true" />
      <div className="career-notification-loading-row" aria-hidden="true" />
    </div>
  );
}

function NotificationPageError({ message, onRetry }: { readonly message: string | null; readonly onRetry: () => void }) {
  return (
    <div className="career-notification-page-error" role="alert">
      <h2>Не удалось загрузить уведомления</h2>
      <p>{message ?? 'Проверьте соединение и попробуйте ещё раз.'}</p>
      <button className="career-btn career-btn-primary" type="button" onClick={onRetry}>Повторить</button>
    </div>
  );
}

function NotificationEmpty({ unreadOnly }: { readonly unreadOnly: boolean }) {
  return (
    <div className="career-notification-empty" role="status">
      <NotificationGlyph kind="email_approval" />
      <h2>{unreadOnly ? 'Непрочитанных уведомлений нет' : 'Новых уведомлений нет'}</h2>
      <p>{unreadOnly ? 'Все уведомления уже прочитаны.' : 'Когда появятся события, они будут собраны здесь.'}</p>
    </div>
  );
}

function NotificationLoadMore({ nextCursor, loading, error, onLoadMore }: {
  readonly nextCursor: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadMore: () => Promise<boolean>;
}) {
  if (error) {
    return (
      <div className="career-notification-more-error" role="alert">
        <p>Не удалось загрузить ещё уведомления.</p>
        <button className="career-btn is-ghost" type="button" onClick={() => void onLoadMore()}>Повторить</button>
      </div>
    );
  }
  if (!nextCursor) return null;
  return (
    <div className="career-notification-more">
      <p>Список загружается частями.</p>
      <button className="career-btn is-ghost" type="button" disabled={loading} onClick={() => void onLoadMore()}>
        {loading ? 'Загружаем…' : 'Загрузить ещё'}
      </button>
    </div>
  );
}
