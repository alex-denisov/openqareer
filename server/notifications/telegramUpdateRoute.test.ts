import { describe, expect, it } from 'vitest';
import { telegramUpdateRoute } from './telegramUpdateRoute';

const SMM_CHAT = '-1004373189840';
const LINK = `/start ${'A'.repeat(43)}`;

describe('telegramUpdateRoute (B732: один бот, один вебхук)', () => {
  it('сообщение и кнопка из чата SMM идут в SMM, даже длинные', () => {
    const long = { update_id: 1, message: { message_id: 5, chat: { id: -1004373189840 }, text: 'x'.repeat(3_000) } };
    expect(telegramUpdateRoute(long, SMM_CHAT)).toBe('smm');
    const button = { update_id: 2, callback_query: { id: 'c', data: 'smm:ok', message: { message_id: 6, chat: { id: -1004373189840 } } } };
    expect(telegramUpdateRoute(button, SMM_CHAT)).toBe('smm');
  });

  it('/start с кодом из личного чата идёт в привязку', () => {
    expect(telegramUpdateRoute({ update_id: 3, message: { chat: { id: 777 }, text: LINK } }, SMM_CHAT)).toBe('link');
    expect(telegramUpdateRoute({ update_id: 3, message: { chat: { id: 777 }, text: `/start@openqareer_bot ${'b'.repeat(40)}` } }, SMM_CHAT)).toBe('link');
  });

  it('остальное — кандидату', () => {
    expect(telegramUpdateRoute({ update_id: 4, message: { chat: { id: 777 }, text: 'привет' } }, SMM_CHAT)).toBe('candidate');
    expect(telegramUpdateRoute({ update_id: 4, message: { chat: { id: 777 }, text: '/start' } }, SMM_CHAT)).toBe('candidate');
    expect(telegramUpdateRoute({ update_id: 5, callback_query: { id: 'c', message: { chat: { id: 777 } } } }, SMM_CHAT)).toBe('candidate');
    expect(telegramUpdateRoute('мусор', SMM_CHAT)).toBe('candidate');
  });

  it('без SMM на сервере чат SMM ничем не выделен', () => {
    const fromSmm = { update_id: 6, message: { chat: { id: -1004373189840 }, text: 'пост' } };
    expect(telegramUpdateRoute(fromSmm, null)).toBe('candidate');
  });
});
