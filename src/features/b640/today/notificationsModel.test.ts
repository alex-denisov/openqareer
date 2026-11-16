import { describe, expect, it } from 'vitest';
import type { CandidateNotification } from '../../notifications/notificationsApi';
import {
  groupNotifications,
  notificationAction,
  notificationWhen,
  unreadHeading,
} from './notificationsModel';

function note(overrides: Partial<CandidateNotification>): CandidateNotification {
  return {
    id: 'n1',
    kind: 'employer_reply',
    title: 'Есть ответ работодателя',
    createdAt: '2026-11-16T07:30:00.000Z',
    readAt: null,
    action: { label: 'Напомнить рекрутеру', href: '/app?view=responses&notificationSource=app-7' },
    ...overrides,
  };
}

const NOW = new Date('2026-11-16T12:00:00.000Z');

describe('b640 уведомления: действие события', () => {
  it('ответ работодателя открывает свой отклик', () => {
    expect(notificationAction(note({}))).toEqual({
      label: 'Открыть отклик',
      path: '/app/responses/app-7',
    });
  });

  it('без источника ответ ведёт в список откликов', () => {
    const action = notificationAction(
      note({ action: { label: 'x', href: '/app?view=responses' } }),
    );
    expect(action.path).toBe('/app/responses');
  });

  it('у каждого вида события свой раздел нового кабинета', () => {
    const paths = (
      [
        'email_approval',
        'post_approval',
        'interview_reminder',
        'new_vacancies_by_role',
        'employer_opened_letter',
        'consultant_edits',
        'footprint_findings',
        'import_completed',
        'delivery_error',
      ] as const
    ).map((kind) => [
      kind,
      notificationAction(note({ kind })).path,
      notificationAction(note({ kind })).label,
    ]);
    expect(paths).toEqual([
      ['email_approval', '/app/responses', 'Проверить письмо'],
      ['post_approval', '/app/profile/linkedin/posts', 'Открыть пост'],
      ['interview_reminder', '/app/responses/next/interview', 'Подготовиться'],
      ['new_vacancies_by_role', '/app/vacancies', 'Смотреть вакансии'],
      ['employer_opened_letter', '/app/responses', 'Открыть отклик'],
      ['consultant_edits', '/app/profile/review', 'Посмотреть правки'],
      ['footprint_findings', '/app/profile/footprint', 'Посмотреть находку'],
      ['import_completed', '/app/profile', 'Открыть профиль'],
      ['delivery_error', '/app/responses', 'Открыть отклик'],
    ]);
  });
});

describe('b640 уведомления: группы и время', () => {
  it('делит на «Сегодня» и «Раньше» по дню кандидата', () => {
    const groups = groupNotifications(
      [
        note({ id: 'a' }),
        note({ id: 'b', createdAt: '2026-11-15T20:00:00.000Z' }),
        note({ id: 'c', createdAt: '2026-11-15T22:30:00.000Z' }),
      ],
      NOW,
      'Europe/Moscow',
    );
    expect(groups.today.map((item) => item.id)).toEqual(['a', 'c']);
    expect(groups.earlier.map((item) => item.id)).toEqual(['b']);
  });

  it('сегодня — время, раньше — день и месяц', () => {
    expect(notificationWhen('2026-11-16T07:30:00.000Z', NOW, 'Europe/Moscow')).toBe('10:30');
    expect(notificationWhen('2026-11-10T07:30:00.000Z', NOW, 'Europe/Moscow')).toBe('10 ноября');
    expect(notificationWhen('нет', NOW, 'Europe/Moscow')).toBe('');
  });

  it('заголовок считает новые', () => {
    expect(unreadHeading(3)).toBe('3 новых');
    expect(unreadHeading(1)).toBe('1 новое');
    expect(unreadHeading(0)).toBe('Новых нет');
  });
});
