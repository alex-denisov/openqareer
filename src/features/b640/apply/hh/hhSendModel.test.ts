import { describe, expect, it } from 'vitest';
import { desktopFailureCode, elapsedLabel, refusalText, resultOf } from './hhSendModel';

describe('B704: исход отклика через hh.ru на экране', () => {
  it('отправлен, анкета, нужен вход', () => {
    expect(resultOf('sent')).toEqual({ kind: 'sent' });
    expect(resultOf('questionnaire')).toEqual({ kind: 'questionnaire' });
    expect(resultOf('failed', 'not_signed_in')).toEqual({ kind: 'signin' });
    expect(resultOf('failed', 'session_window_missing')).toEqual({ kind: 'signin' });
  });

  it('сбой — словами кандидата, без внутренних кодов', () => {
    expect(resultOf('failed', 'captcha')).toEqual({
      kind: 'error',
      text: 'hh.ru просит пройти проверку. Пройдите её в окне hh.ru и отправьте снова.',
    });
    const unknown = resultOf('failed', 'script_error');
    expect(unknown).toEqual({ kind: 'error', text: 'Отклик не отправлен. Повторите.' });
    expect(refusalText('hh_daily_limit_reached')).toContain('Завтра');
    expect(refusalText(undefined)).toBe('Отклик не отправлен. Повторите.');
  });

  it('время ожидания и код сбоя окна', () => {
    expect(elapsedLabel(42)).toBe('0:42');
    expect(elapsedLabel(61)).toBe('1:01');
    expect(elapsedLabel(-3)).toBe('0:00');
    expect(desktopFailureCode('session_window_missing')).toBe('session_window_missing');
    expect(desktopFailureCode(new Error('page_load_timeout: 30s'))).toBe('page_load_timeout');
    expect(desktopFailureCode('Что-то <b>')).toBe('desktop_failed');
  });
});
