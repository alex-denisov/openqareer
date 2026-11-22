import { describe, expect, it } from 'vitest';
import { acceptModelMessage, modelMessageRejection } from './b640ContactMessage';
import { B640_CONTACT_MESSAGE_DRAFT_MAX } from '../../shared/b640ContactMessage';

describe('B753: почему текст модели не принят', () => {
  const known = 'Пётр, директор по данным, 12 лет';

  it('пустой, длинный, с новыми цифрами — своя причина; годный — без причины', () => {
    expect(modelMessageRejection(undefined, known)).toBe('empty');
    expect(modelMessageRejection('   ', known)).toBe('empty');
    expect(modelMessageRejection('а'.repeat(B640_CONTACT_MESSAGE_DRAFT_MAX + 1), known)).toBe('too_long');
    expect(modelMessageRejection('Привет! У меня 15 лет опыта.', known)).toBe('new_digits');
    expect(modelMessageRejection('Привет! У меня 12 лет опыта.', known)).toBeNull();
  });

  it('acceptModelMessage принимает ровно то, у чего нет причины', () => {
    expect(acceptModelMessage('Привет! У меня 12 лет опыта.', known)).toBe('Привет! У меня 12 лет опыта.');
    expect(acceptModelMessage('Привет! У меня 15 лет опыта.', known)).toBeNull();
  });
});
