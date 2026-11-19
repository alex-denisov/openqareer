import { describe, expect, it } from 'vitest';
import type { B640Notification } from './b640NotificationsApi';
import { FEED_FILTERS, feedAction, feedSubtitle } from './feedModel';

function item(overrides: Partial<B640Notification>): B640Notification {
  return {
    id: 'n1',
    kind: 'interview_invitation',
    category: 'invitations',
    important: true,
    title: 'Арка Холдинг приглашает на интервью',
    company: 'Арка Холдинг',
    role: 'Руководитель платформы',
    eventAt: '2026-11-12T12:00:00.000Z',
    createdAt: '2026-11-16T07:05:00.000Z',
    readAt: null,
    sourceType: 'application',
    sourceId: 'app-7',
    ...overrides,
  };
}

const NOW = new Date('2026-11-16T12:00:00.000Z');
const TZ = 'Europe/Moscow';

describe('B671 лента уведомлений', () => {
  it('фильтры — как в макете N01b', () => {
    expect(FEED_FILTERS.map((filter) => filter.label)).toEqual([
      'Все',
      'Приглашения',
      'Отклики',
      'Вакансии',
    ]);
  });

  it('подпись: роль, время события и время уведомления', () => {
    expect(feedSubtitle(item({}), NOW, TZ)).toBe(
      'Руководитель платформы · 12 ноября, 15:00 · 10:05',
    );
    expect(feedSubtitle(item({ role: null, eventAt: null }), NOW, TZ)).toBe('10:05');
    expect(
      feedSubtitle(item({ createdAt: '2026-11-09T07:05:00.000Z', eventAt: null }), NOW, TZ),
    ).toBe('Руководитель платформы · 9 ноября');
  });

  it('действие ведёт к отклику, подключениям или подборке', () => {
    expect(feedAction(item({}))).toEqual({ label: 'Ответить', path: '/app/responses/app-7' });
    expect(feedAction(item({ kind: 'offer' }))).toEqual({
      label: 'Ответить',
      path: '/app/responses/app-7',
    });
    expect(feedAction(item({ kind: 'questionnaire' })).label).toBe('Заполнить');
    expect(feedAction(item({ kind: 'platform_login_required' }))).toEqual({
      label: 'Подключить',
      path: '/app/account/connections',
    });
    expect(feedAction(item({ kind: 'delivery_error' }))).toEqual({
      label: 'Открыть отклик',
      path: '/app/responses/app-7',
    });
    const vacancies = feedAction(
      item({ kind: 'new_vacancies_by_role', sourceType: 'matched_vacancy_batch' }),
    );
    expect(vacancies.label).toBe('Смотреть вакансии');
  });
});
