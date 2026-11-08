import { describe, expect, it } from 'vitest';
import type { GeneratedTextFactCheck } from '../domain/generatedTextFactGate';
import { letterNotices } from './vacancyPitchRoutes';

type NoticeInput = Parameters<typeof letterNotices>[0];

const unconfirmed: GeneratedTextFactCheck = {
  scope: 'quantities_and_explicit_achievements',
  status: 'needs_confirmation',
  claims: [{ text: 'выручка выросла в 3 раза', status: 'not_in_profile', evidenceIds: [], action: 'ask_candidate' }],
};
const clean: GeneratedTextFactCheck = { scope: 'quantities_and_explicit_achievements', status: 'checked', claims: [] };

function input(modelBody: string | null, check: GeneratedTextFactCheck, templateNotices: string[] = []): NoticeInput {
  return {
    pitch: { language: 'ru', notices: templateNotices },
    written: modelBody ? { body: modelBody, factCheck: check } : { body: null },
    outputFactChecks: { emailBody: check, linkedInNote: unconfirmed },
  } as unknown as NoticeInput;
}

describe('letterNotices: подписи «написала модель» нет (08.11)', () => {
  it('письмо модели без фактов вне профиля приходит без примечаний', () => {
    expect(letterNotices(input('Здравствуйте!', clean))).toEqual([]);
  });

  it('письмо модели сохраняет предупреждение о конкретном неподтверждённом факте', () => {
    const [notice] = letterNotices(input('Здравствуйте!', unconfirmed));
    expect(notice).toContain('«выручка выросла в 3 раза»');
    expect(notice).not.toContain('модел');
  });

  it('примечания и проверки шаблонных текстов не переходят к письму модели', () => {
    const few = 'В профиле мало подтверждённых фактов.';
    expect(letterNotices(input('Здравствуйте!', clean, [few]))).toEqual([]);
    expect(letterNotices(input(null, clean, [few]))[0]).toContain('«выручка выросла в 3 раза»');
  });
});
