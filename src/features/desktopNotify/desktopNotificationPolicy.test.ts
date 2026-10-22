import { describe, expect, it } from 'vitest';
import { planDesktopNotificationBatch } from './desktopNotificationPolicy';

describe('planDesktopNotificationBatch', () => {
  it('selects only fresh unread vacancy and recruiter reply events not already shown', () => {
    const batch = planDesktopNotificationBatch(
      [
        item('vacancy-new', 'new_vacancies_by_role', '2026-10-21T10:01:00.000Z'),
        item('reply-new', 'employer_reply', '2026-10-21T10:02:00.000Z'),
        item('other-kind', 'interview_reminder', '2026-10-21T10:03:00.000Z'),
        item(
          'already-read',
          'employer_reply',
          '2026-10-21T10:04:00.000Z',
          '2026-10-21T10:05:00.000Z',
        ),
        item('old', 'employer_reply', '2026-10-20T10:00:00.000Z'),
        item('shown', 'new_vacancies_by_role', '2026-10-21T10:06:00.000Z'),
      ],
      {
        enabled: true,
        enabledAt: '2026-10-21T10:00:00.000Z',
        lastPollAt: null,
        seenIds: ['shown'],
      },
      true,
      '2026-10-21T10:10:00.000Z',
    );

    expect(batch.notices.map((notice) => notice.ids)).toEqual([['reply-new'], ['vacancy-new']]);
    expect(batch.notices.every((notice) => !notice.body.includes('private-id'))).toBe(true);
  });

  it('caps individual notices at three and summarizes the remaining ids', () => {
    const batch = planDesktopNotificationBatch(
      Array.from({ length: 5 }, (_, index) =>
        item(
          `event-${index}`,
          index % 2 === 0 ? 'employer_reply' : 'new_vacancies_by_role',
          `2026-10-21T10:0${index}:00.000Z`,
        ),
      ),
      { enabled: true, enabledAt: '2026-10-21T10:00:00.000Z', lastPollAt: null, seenIds: [] },
      true,
      '2026-10-21T10:10:00.000Z',
    );

    expect(batch.notices).toHaveLength(4);
    expect(batch.notices.slice(0, 3).every((notice) => notice.ids.length === 1)).toBe(true);
    expect(batch.notices[3]).toMatchObject({
      ids: ['event-1', 'event-0'],
      body: 'Ещё 2 новых событий.',
      target: 'notifications',
    });
  });

  it('does nothing when disabled or outside Tauri', () => {
    const items = [item('reply', 'employer_reply', '2026-10-21T10:01:00.000Z')];
    const checkpoint = {
      enabled: true,
      enabledAt: '2026-10-21T10:00:00.000Z',
      lastPollAt: null,
      seenIds: [],
    };

    expect(
      planDesktopNotificationBatch(
        items,
        { ...checkpoint, enabled: false },
        true,
        '2026-10-21T10:10:00.000Z',
      ),
    ).toEqual({
      notices: [],
    });
    expect(
      planDesktopNotificationBatch(items, checkpoint, false, '2026-10-21T10:10:00.000Z'),
    ).toEqual({ notices: [] });
  });
});

function item(
  id: string,
  kind: 'new_vacancies_by_role' | 'employer_reply' | 'interview_reminder',
  createdAt: string,
  readAt: string | null = null,
) {
  return {
    id,
    kind,
    createdAt,
    readAt,
    title: 'Не использовать личный заголовок',
    action: { label: 'Открыть', href: '/app?view=responses&notificationSource=private-id' },
  };
}
