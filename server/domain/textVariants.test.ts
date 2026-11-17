import { describe, expect, it } from 'vitest';
import { normalizeWish, wishInstruction } from './textVariants';

describe('B682: пожелание к варианту', () => {
  it('оставляет известные чипы в постоянном порядке и чистит текст', () => {
    expect(
      normalizeWish({ chips: ['numbers', 'bogus', 'shorter', 'shorter'], text: '  без «воды»\n‮ и\tканцелярита  ' }),
    ).toEqual({ chips: ['shorter', 'numbers'], text: 'без воды и канцелярита' });
    expect(normalizeWish(undefined)).toEqual({ chips: [], text: '' });
    expect(normalizeWish({ text: 'x'.repeat(500) }).text).toHaveLength(300);
  });

  it('пожелание — цитата, правила о фактах остаются', () => {
    const text = wishInstruction({ chips: ['shorter', 'numbers'], text: 'начни с результата' });
    expect(text).toContain('сделай текст заметно короче; покажи больше цифр — только тех, что уже есть в профиле.');
    expect(text).toContain('Своими словами кандидат просит: «начни с результата».');
    expect(text).toContain('новых не добавляй');
  });

  it('без пожелания просит просто другой вариант', () => {
    const text = wishInstruction({ chips: [], text: '' });
    expect(text).toContain('другой вариант того же текста');
    expect(text).not.toContain('Пожелание кандидата к этому варианту');
  });
});
