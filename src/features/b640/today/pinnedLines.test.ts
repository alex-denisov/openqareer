import { describe, expect, it } from 'vitest';
import type { B640Notification } from './b640NotificationsApi';
import { pinnedLines } from './pinnedLines';

function item(overrides: Partial<B640Notification>): B640Notification {
  return {
    id: 'n1',
    kind: 'interview_invitation',
    category: 'invitations',
    important: true,
    title: 'Арка Холдинг приглашает на интервью',
    company: 'Арка Холдинг',
    role: null,
    eventAt: null,
    createdAt: '2026-11-16T07:05:00.000Z',
    readAt: null,
    sourceType: 'application',
    sourceId: 'app-7',
    ...overrides,
  };
}

const hhSession = item({
  id: 'hh',
  kind: 'delivery_error',
  category: 'responses',
  title: 'Сессия hh.ru истекла',
  company: null,
  sourceType: 'hh_session',
  sourceId: 'hh',
});
const loginLadoga = item({
  id: 'l1',
  kind: 'platform_login_required',
  category: 'responses',
  title: 'Отклик не доставлен · Ладога Банк',
  company: 'Ладога Банк',
});
const failed = item({
  id: 'f1',
  kind: 'delivery_error',
  category: 'responses',
  title: 'Отклик не доставлен · Карта',
  company: 'Карта',
});

describe('n01b «Важно»: сводка входов', () => {
  it('два входа — одна строка «2 подключения требуют входа» со списком и «Подключить»', () => {
    const lines = pinnedLines([hhSession, failed, loginLadoga]);
    expect(lines.map((line) => line.title)).toEqual([
      '2 подключения требуют входа',
      'Отклик не дошёл · Карта',
    ]);
    expect(lines[0]).toMatchObject({
      detail: 'hh.ru, Ладога Банк',
      action: { label: 'Подключить', path: '/app/account/connections', icon: 'refresh' },
    });
    expect(lines[0]!.items.map((entry) => entry.id)).toEqual(['hh', 'l1']);
  });

  it('один вход остаётся своей строкой; сессия hh.ru не называется «Отклик не дошёл»', () => {
    const lines = pinnedLines([failed, hhSession]);
    expect(lines.map((line) => line.title)).toEqual([
      'Отклик не дошёл · Карта',
      'Сессия hh.ru истекла',
    ]);
    expect(lines.every((line) => line.detail === null)).toBe(true);
  });
});
