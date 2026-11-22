import { describe, expect, it } from 'vitest';
import type { CandidateConnection } from '../../coach/coachApi';
import {
  connectedCount,
  connectionLine,
  connectionsSummary,
  deviceLine,
  devicesTitle,
  NOTIFICATION_ROWS,
  notificationsSummary,
  securitySummary,
  updatedLine,
} from './model';

const base = { available: true, capabilities: [] as CandidateConnection['capabilities'], importsCareerHistory: false };
const hh: CandidateConnection = {
  ...base,
  platform: 'hh',
  status: 'connected',
  accessMode: 'native_session_snapshot',
  connectedAt: '2026-11-10T09:00:00.000Z',
  lastImportedAt: '2026-11-17T06:12:00.000Z',
  factCount: 12,
};
const linkedin: CandidateConnection = { ...base, platform: 'linkedin', status: 'disconnected' };
const linkedinOn: CandidateConnection = { ...hh, platform: 'linkedin' };

describe('модель «Аккаунта»', () => {
  it('подпись раздела «Вход и безопасность» считает устройства', () => {
    expect(securitySummary(1)).toBe('Пароль, 1 устройство');
    expect(securitySummary(2)).toBe('Пароль, 2 устройства');
    expect(securitySummary(5)).toBe('Пароль, 5 устройств');
    expect(devicesTitle(2)).toBe('Устройства · 2');
  });

  it('подпись раздела «Подключения» называет подключённые площадки', () => {
    expect(connectionsSummary([hh, linkedin])).toBe('hh.ru подключён');
    expect(connectionsSummary([hh, linkedinOn])).toBe(
      'hh.ru и LinkedIn подключены',
    );
    expect(connectionsSummary([linkedin])).toBe('Площадки не подключены');
    expect(connectionsSummary([])).toBe('Площадки не подключены');
  });

  it('строка площадки: состояние без лишних слов', () => {
    expect(connectionLine(hh)).toBe('подключено');
    expect(connectionLine(linkedin)).toBe('не подключено');
    expect(connectionLine({ ...base, platform: 'hh', status: 'imported', importedAt: '2026-11-01' })).toBe(
      'данные загружены, вход не выполнен',
    );
  });

  it('счёт подключений: почта, две площадки и Telegram', () => {
    expect(connectedCount({ emailVerified: true, connections: [hh, linkedin], telegram: false })).toEqual({
      connected: 2,
      total: 4,
    });
    expect(connectedCount({ emailVerified: false, connections: [], telegram: null })).toEqual({
      connected: 0,
      total: 3,
    });
  });

  it('«Обновлено»: сегодня и вчера со временем, раньше — день и месяц', () => {
    const now = new Date(2026, 10, 17, 12, 0);
    expect(updatedLine(new Date(2026, 10, 17, 9, 12).toISOString(), now)).toBe('Обновлено сегодня, 09:12');
    expect(updatedLine(new Date(2026, 10, 16, 22, 40).toISOString(), now)).toBe('Обновлено вчера, 22:40');
    expect(updatedLine(new Date(2026, 10, 3, 8, 0).toISOString(), now)).toBe('Обновлено 3 ноября');
    expect(updatedLine('нет', now)).toBeNull();
  });

  it('строка устройства: текущая сессия и время последнего входа', () => {
    const now = new Date(2026, 10, 17, 12, 0);
    const session = {
      id: 'a',
      current: true,
      createdAt: '2026-11-01T10:00:00.000Z',
      lastSeenAt: new Date(2026, 10, 17, 11, 59).toISOString(),
      expiresAt: '2026-12-17T10:00:00.000Z',
    };
    expect(deviceLine(session, now)).toBe('сейчас · эта сессия');
    expect(deviceLine({ ...session, current: false, lastSeenAt: new Date(2026, 10, 16, 21, 40).toISOString() }, now)).toBe(
      'вчера, 21:40',
    );
  });

  it('сводка уведомлений называет каналы, куда хоть что-то приходит', () => {
    const row = (app: boolean, email: boolean, telegram: boolean) => ({
      key: 'ev-reply' as const,
      app,
      email,
      telegram,
    });
    expect(notificationsSummary([row(true, true, false)])).toBe('В приложении и на почту');
    expect(notificationsSummary([row(true, false, false), row(false, false, true)])).toBe(
      'В приложении и в Telegram',
    );
    expect(notificationsSummary([row(false, false, false)])).toBe('Выключены');
    expect(notificationsSummary([row(true, true, true)])).toBe('В приложении, на почту и в Telegram');
  });

  it('B690: Telegram не привязан — в подписи раздела его нет, хотя галочка сохранена', () => {
    const row = (telegram: boolean) => ({ key: 'ev-reply' as const, app: true, email: true, telegram });
    expect(notificationsSummary([row(true)], false)).toBe('В приложении и на почту');
    expect(notificationsSummary([{ ...row(true), app: false, email: false }], false)).toBe('Выключены');
  });

  it('строки настроек: все события сервера, подписи простым языком', () => {
    expect(NOTIFICATION_ROWS.map((row) => row.key)).toEqual([
      'ev-invitation',
      'ev-reply',
      'ev-reminder',
      'ev-approval',
      'ev-delivery-error',
      'ev-target-company',
      'ev-weekly-digest',
    ]);
    expect(NOTIFICATION_ROWS.map((row) => row.label)).toEqual([
      'Приглашения',
      'Ответы',
      'Напоминания',
      'Письмо на одобрение',
      'Сбой отклика',
      'Вакансии нужных компаний',
      'Итоги недели',
    ]);
  });
});
