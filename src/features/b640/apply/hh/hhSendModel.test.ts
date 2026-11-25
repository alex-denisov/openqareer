import { describe, expect, it } from 'vitest';
import { desktopFailureCode, elapsedLabel, refusalOf, refusalText, resultOf, uniqueResumeTitle } from './hhSendModel';

describe('B704: исход отклика через hh.ru на экране', () => {
  it('отправлен, анкета, нужен вход', () => {
    expect(resultOf('sent')).toEqual({ kind: 'sent' });
    expect(resultOf('questionnaire')).toEqual({ kind: 'questionnaire' });
    expect(resultOf('failed', 'not_signed_in')).toEqual({ kind: 'signin' });
    for (const code of ['session_window_missing', 'hh_window_not_opened', 'hh_window_not_loaded']) {
      expect(resultOf('failed', code)).toMatchObject({ kind: 'error', text: expect.stringContaining('отклик не отправлен') });
    }
  });

  it('сбой — словами кандидата, без внутренних кодов', () => {
    expect(resultOf('failed', 'captcha')).toEqual({
      kind: 'error',
      text: 'hh.ru просит пройти проверку. Пройдите её в окне hh.ru и отправьте снова.',
      inWindow: true,
      captcha: true,
    });
    expect(resultOf('failed', 'no_response_button')).toMatchObject({ text: expect.stringContaining('не догрузилась') });
    expect(refusalOf('hh_already_applied')).toEqual({ kind: 'already' });
    const unknown = resultOf('failed', 'script_error');
    expect(unknown).toEqual({ kind: 'error', text: 'Отклик не отправлен. Повторите.', inWindow: true });
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

describe('B708: заголовок резюме как запасной признак', () => {
  const snapshot = (...titles: string[]) => ({
    resumes: titles.map((title, index) => ({ id: `id${index}`, title })),
    selected: { id: 'id0', title: titles[0]!, text: 'Опыт' },
    readAt: '2026-11-24T10:00:00.000Z',
  });

  it('передаётся, только если у кандидата он один', () => {
    expect(uniqueResumeTitle(null)).toBeUndefined();
    expect(uniqueResumeTitle(snapshot('Операционный\u00a0директор (COO) ', 'CDO'))).toBe('Операционный директор (COO)');
    expect(uniqueResumeTitle(snapshot('COO', ' COO'))).toBeUndefined();
    expect(uniqueResumeTitle({ ...snapshot('COO'), resumes: [] })).toBeUndefined();
    expect(uniqueResumeTitle(snapshot('CO\u0000O'))).toBeUndefined();
  });
});
