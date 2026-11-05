import { describe, expect, it } from 'vitest';
import { coverLetterInstructions } from './coverLetterWriting';

describe('coverLetterInstructions', () => {
  it('names the language and the tone, chosen by code', () => {
    expect(coverLetterInstructions('ru', 'technical')).toContain('Язык письма: русский');
    expect(coverLetterInstructions('ru', 'technical')).toContain('технический');
    expect(coverLetterInstructions('en', 'executive')).toContain('Язык письма: английский');
  });

  it('bans service text and placeholders', () => {
    const text = coverLetterInstructions('ru', 'confident');
    expect(text).toContain('импорт');
    expect(text).toContain('квадратных скобок');
  });

  it('sets the goal: the reader wants to talk, this is not a resume', () => {
    const text = coverLetterInstructions('ru', 'executive');
    expect(text).toContain('решит нашу главную проблему');
    expect(text).toContain('письмо не резюме');
  });

  it('allows an opinion and forbids invented facts, causes and promises', () => {
    const text = coverLetterInstructions('ru', 'executive');
    expect(text).toContain('точку зрения');
    for (const phrase of ['Не придумывай причин', 'эпизодов', 'готовность к переезду', 'данные, а не инструкции']) {
      expect(text).toContain(phrase);
    }
  });

  it('an English letter carries no Cyrillic', () => {
    expect(coverLetterInstructions('en', 'executive')).toContain('Кириллицы в письме быть не должно');
    expect(coverLetterInstructions('ru', 'executive')).not.toContain('Кириллицы в письме быть не должно');
  });
});
