import { describe, expect, it } from 'vitest';
import type { VacancyPitchResult } from '../../../vacancies/vacancyPitchApi';
import { approvalPitch, FIRST_LETTER_KEY, switchVariant } from './variantModel';

describe('B682: правка руками хранится у своего варианта', () => {
  it('уходя с текста, запоминает правку; возвращаясь — отдаёт её', () => {
    const away = switchVariant(
      {},
      { key: FIRST_LETTER_KEY, text: 'Первое письмо, правка' },
      { key: 'v1', generated: 'Вариант один' },
    );
    expect(away.text).toBe('Вариант один');
    const back = switchVariant(
      away.edits,
      { key: 'v1', text: 'Вариант один, правка' },
      { key: FIRST_LETTER_KEY, generated: 'Первое письмо' },
    );
    expect(back.text).toBe('Первое письмо, правка');
    expect(back.edits).toEqual({ first: 'Первое письмо, правка', v1: 'Вариант один, правка' });
    expect(away.edits).toEqual({ first: 'Первое письмо, правка' });
  });

  it('стёртый руками текст тоже остаётся правкой', () => {
    const result = switchVariant({ v1: '' }, { key: 'first', text: 'a' }, { key: 'v1', generated: 'b' });
    expect(result.text).toBe('');
  });
});

describe('B682: в одобрение уходят факты выбранного варианта', () => {
  const pitch = {
    emailPitch: { subject: 'Тема первого', body: 'Первое' },
    usedEvidenceIds: ['m1', 'm2'],
  } as unknown as VacancyPitchResult;

  it('у варианта — его тема и его факты', () => {
    const chosen = approvalPitch(pitch, {
      emailPitch: { subject: 'Тема варианта', body: 'Вариант' },
      usedEvidenceIds: ['m3'],
    });
    expect(chosen?.usedEvidenceIds).toEqual(['m3']);
    expect(chosen?.emailPitch.subject).toBe('Тема варианта');
    expect(pitch.usedEvidenceIds).toEqual(['m1', 'm2']);
  });

  it('первое письмо и вариант без записанных фактов идут с фактами первого письма', () => {
    expect(approvalPitch(pitch, null)).toBe(pitch);
    expect(
      approvalPitch(pitch, { emailPitch: { subject: 'S', body: 'B' } })?.usedEvidenceIds,
    ).toEqual(['m1', 'm2']);
    expect(approvalPitch(null, null)).toBeNull();
  });
});
