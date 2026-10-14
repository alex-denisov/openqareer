import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsScreen } from './NotificationsScreen';
import {
  isNotificationToday,
  notificationDateLabel,
  notificationDescription,
  notificationPrimaryLabel,
  notificationSecondaryLabel,
  notificationSource,
  notificationTargetView,
} from './notificationPresentation';
import { scheduleInterviewReminder, scheduleRecruiterReminder } from './notificationActions';
import * as useNotificationsModule from './useNotifications';
import * as applicationsApiModule from '../applications/applicationsApi';
import type { CandidateNotification } from './notificationsApi';

const SAMPLE_NOTIFICATION: CandidateNotification = {
  id: 'notice-interview-1',
  kind: 'interview_reminder',
  title: 'Скоро интервью в Арка Холдинг',
  createdAt: new Date().toISOString(),
  readAt: null,
  action: {
    label: 'Напомнить за день',
    href: '/app?view=responses&notificationSource=interview-1',
  },
};

const SAMPLE_POST_NOTIFICATION: CandidateNotification = {
  id: 'notice-post-1',
  kind: 'post_approval',
  title: 'Одобрить пост о миграции платформы',
  createdAt: '2026-10-01T10:00:00.000Z',
  readAt: '2026-10-02T10:00:00.000Z',
  action: {
    label: 'Открыть пост',
    href: '/app?view=profile',
  },
};

function createMockNotifications(overrides: Partial<ReturnType<typeof useNotificationsModule.useNotifications>>): ReturnType<typeof useNotificationsModule.useNotifications> {
  return {
    items: [],
    unreadCount: 0,
    nextCursor: null,
    status: 'ready',
    error: null,
    loadingMore: false,
    moreError: null,
    actionError: null,
    retry: vi.fn(),
    loadMore: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearActionError: vi.fn(),
    setPage: vi.fn(),
    ...overrides,
  };
}

describe('NotificationsScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state when notifications are being fetched', () => {
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue(
      createMockNotifications({ status: 'loading' }),
    );

    const html = renderToStaticMarkup(
      <NotificationsScreen
        onUnreadCountChange={vi.fn()}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(html).toContain('Загружаем уведомления…');
    expect(html).toContain('career-notification-loading');
  });

  it('renders error state when notification loading fails', () => {
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue(
      createMockNotifications({
        status: 'error',
        error: 'Сетевая ошибка при загрузке.',
      }),
    );

    const html = renderToStaticMarkup(
      <NotificationsScreen
        onUnreadCountChange={vi.fn()}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(html).toContain('Не удалось загрузить уведомления');
    expect(html).toContain('Сетевая ошибка при загрузке.');
    expect(html).toContain('Повторить');
  });

  it('renders empty state when there are no notifications', () => {
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue(
      createMockNotifications({ items: [], unreadCount: 0, status: 'ready' }),
    );

    const html = renderToStaticMarkup(
      <NotificationsScreen
        onUnreadCountChange={vi.fn()}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(html).toContain('Новых уведомлений нет');
    expect(html).toContain('Когда появятся события, они будут собраны здесь.');
  });

  it('renders notifications list, detail, actions, and mockup footer notes', () => {
    vi.spyOn(useNotificationsModule, 'useNotifications').mockReturnValue(
      createMockNotifications({
        items: [SAMPLE_NOTIFICATION, SAMPLE_POST_NOTIFICATION],
        unreadCount: 1,
        status: 'ready',
      }),
    );

    const html = renderToStaticMarkup(
      <NotificationsScreen
        initialSelectedId={SAMPLE_NOTIFICATION.id}
        onUnreadCountChange={vi.fn()}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenExpert={vi.fn()}
      />,
    );

    expect(html).toContain('Скоро интервью в Арка Холдинг');
    expect(html).toContain('Одобрить пост о миграции платформы');
    expect(html).toContain('Подготовиться');
    expect(html).toContain('Напомнить за день');
    expect(html).toContain('Обсудить с консультантом');
    expect(html).toContain('Ночью, с 22:00 до 08:00, уведомления копятся и приходят утром.');
    expect(html).toContain('Открытие уведомления отмечает его прочитанным.');
  });
});

describe('notificationPresentation helpers', () => {
  it('returns valid description and source for each kind', () => {
    expect(notificationDescription('interview_reminder')).toContain('интервью');
    expect(notificationSource('interview_reminder')).toBe('Расписание интервью');
    expect(notificationDescription('post_approval')).toContain('поста');
  });

  it('maps primary and secondary labels and target view', () => {
    expect(notificationPrimaryLabel(SAMPLE_NOTIFICATION)).toBe('Подготовиться');
    expect(notificationSecondaryLabel(SAMPLE_NOTIFICATION)).toBe('Напомнить за день');
    expect(notificationTargetView(SAMPLE_NOTIFICATION)).toBe('responses');
    expect(notificationSecondaryLabel(SAMPLE_POST_NOTIFICATION)).toBeNull();
    expect(notificationTargetView(SAMPLE_POST_NOTIFICATION)).toBe('profile');
  });

  it('correctly identifies today timestamps and formats date labels', () => {
    expect(isNotificationToday(new Date().toISOString())).toBe(true);
    expect(notificationDateLabel(new Date().toISOString())).toBe('сегодня');
    expect(notificationDateLabel('2026-10-01T10:00:00.000Z')).toBe('01.10');
  });
});

describe('notificationActions', () => {
  it('schedules an interview reminder on the matched application', async () => {
    const patchMock = vi.spyOn(applicationsApiModule, 'patchApplicationInterview').mockResolvedValue({} as never);
    vi.spyOn(applicationsApiModule, 'listApplications').mockResolvedValue([
      {
        id: 'app-1',
        nearestInterview: {
          id: 'interview-1',
          scheduledAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        },
      } as never,
    ]);

    await scheduleInterviewReminder(SAMPLE_NOTIFICATION);
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith('app-1', 'interview-1', expect.objectContaining({
      followUpDueAt: expect.any(String),
    }));
  });

  it('schedules a recruiter reminder on the matched application', async () => {
    const patchAppMock = vi.spyOn(applicationsApiModule, 'patchApplication').mockResolvedValue({} as never);
    vi.spyOn(applicationsApiModule, 'listApplications').mockResolvedValue([
      {
        id: 'app-99',
        version: 1,
      } as never,
    ]);

    const replyNotice: CandidateNotification = {
      id: 'notice-reply',
      kind: 'employer_reply',
      title: 'Ответ',
      createdAt: new Date().toISOString(),
      readAt: null,
      action: {
        label: 'Напомнить рекрутеру',
        href: '/app?view=responses&notificationSource=app-99',
      },
    };

    await scheduleRecruiterReminder(replyNotice);
    expect(patchAppMock).toHaveBeenCalledTimes(1);
    expect(patchAppMock).toHaveBeenCalledWith('app-99', expect.objectContaining({
      expectedVersion: 1,
      followUpDueAt: expect.any(String),
    }));
  });
});
