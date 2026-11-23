import { describe, expect, it } from 'vitest';
import type { B640Notification } from './b640NotificationsApi';
import { FEED_FILTERS, feedAction, feedSubtitle, pinnedAction, pinnedTitle } from './feedModel';

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

  it('время события совпадает с временем записи — дата не повторяется (B671)', () => {
    const at = '2026-11-09T07:05:00.000Z';
    expect(feedSubtitle(item({ role: 'COO и ещё 10', eventAt: at, createdAt: at }), NOW, TZ)).toBe(
      'COO и ещё 10 · 9 ноября, 10:05',
    );
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

describe('n01b: блок «Важно»', () => {
  it('сбой доставки — «Отклик не дошёл · компания · роль» и «Повторить» к письму отклика', () => {
    const failed = item({
      kind: 'delivery_error',
      title: 'Отклик не доставлен · Ладога Банк',
      company: 'Ладога Банк',
      role: 'Руководитель разработки',
    });
    expect(pinnedTitle(failed)).toBe('Отклик не дошёл · Ладога Банк · Руководитель разработки');
    expect(pinnedAction(failed)).toEqual({
      label: 'Повторить',
      path: '/app/responses/app-7/letter',
      icon: 'repeat',
    });
  });

  it('вход на площадку — «Подключить» с иконкой, прочие — без изменений', () => {
    const login = item({ kind: 'platform_login_required', title: 'Отклик не доставлен · Карта' });
    expect(pinnedAction(login)).toMatchObject({ label: 'Подключить', icon: 'refresh' });
    expect(pinnedTitle(login)).toBe('Отклик не доставлен · Карта · Руководитель платформы');
    expect(pinnedAction(item({}))).not.toHaveProperty('icon');
  });

  it('подборка дня: без даты события — сегодня время, раньше день', () => {
    const digest = item({
      kind: 'new_vacancies_by_role',
      role: null,
      eventAt: null,
      createdAt: '2026-11-16T07:05:00.000Z',
    });
    expect(feedSubtitle(digest, NOW, TZ)).toBe('10:05');
    expect(feedSubtitle({ ...digest, createdAt: '2026-11-14T07:05:00.000Z' }, NOW, TZ)).toBe(
      '14 ноября',
    );
  });
});
