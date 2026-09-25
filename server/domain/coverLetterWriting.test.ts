import { describe, expect, it } from 'vitest';
import {
  COVER_LETTER_MAX_CHARS,
  coverLetterBodySchema,
  coverLetterInstructions,
} from './coverLetterWriting';

describe('coverLetterInstructions', () => {
  it('называет язык и тон письма', () => {
    const ru = coverLetterInstructions('ru', 'technical');
    expect(ru).toContain('русском');
    expect(ru).toContain('технический');

    const en = coverLetterInstructions('en', 'executive');
    expect(en).toContain('английском');
  });

  it('запрещает служебный текст и заглушки', () => {
    const instructions = coverLetterInstructions('ru', 'confident');
    expect(instructions).toContain('импорт');
    expect(instructions).toContain('квадратных скобок');
  });
});

describe('coverLetterBodySchema', () => {
  it('принимает непустой текст в пределах лимита', () => {
    const result = coverLetterBodySchema.safeParse({ body: 'Здравствуйте!' });
    expect(result.success).toBe(true);
  });

  it('отклоняет текст длиннее лимита', () => {
    const tooLong = 'a'.repeat(COVER_LETTER_MAX_CHARS + 1);
    const result = coverLetterBodySchema.safeParse({ body: tooLong });
    expect(result.success).toBe(false);
  });

  it('отклоняет пустой текст', () => {
    const result = coverLetterBodySchema.safeParse({ body: '   ' });
    expect(result.success).toBe(false);
  });
});
