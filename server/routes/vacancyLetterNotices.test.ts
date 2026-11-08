import { describe, expect, it } from 'vitest';
import { letterNotices } from './vacancyPitchRoutes';

type NoticeInput = Parameters<typeof letterNotices>[0];

function input(modelBody: string | null, templateNotices: string[] = []): NoticeInput {
  return {
    pitch: { language: 'ru', notices: templateNotices },
    written: modelBody ? { body: modelBody } : { body: null },
  } as unknown as NoticeInput;
}

describe('letterNotices: проверка фактов внутренняя, под письмом без подсказок (B623)', () => {
  it('письмо модели приходит без примечаний', () => {
    expect(letterNotices(input('Здравствуйте!'))).toEqual([]);
  });

  it('примечание шаблона о нехватке фактов к письму модели не переходит', () => {
    expect(letterNotices(input('Здравствуйте!', ['В профиле мало подтверждённых фактов.']))).toEqual([]);
  });

  it('под шаблонным текстом остаётся одно примечание о нехватке фактов, без «сверьте с профилем»', () => {
    const notices = letterNotices(input(null, ['В профиле мало подтверждённых фактов.', 'Второе.']));
    expect(notices).toEqual(['В профиле мало подтверждённых фактов.']);
  });
});
