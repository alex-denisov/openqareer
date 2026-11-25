import { describe, expect, it } from 'vitest';
import { factCorrectionSchema, MEMORY_TEXT_MAX } from './factCorrection';

const change = (kind: 'memory' | 'about', length: number) => ({
  target: kind === 'memory' ? { kind, id: 'm1' } : { kind },
  before: 'Было',
  after: 'а'.repeat(length),
});
const accepted = (kind: 'memory' | 'about', length: number) =>
  factCorrectionSchema.safeParse(change(kind, length)).success;

describe('B801: предел текста исправления', () => {
  it('запись профиля — не длиннее снимка фактов резюме', () => {
    expect(accepted('memory', MEMORY_TEXT_MAX)).toBe(true);
    expect(accepted('memory', MEMORY_TEXT_MAX + 1)).toBe(false);
  });

  it('«О себе» длиннее записи профиля можно', () => {
    expect(accepted('about', MEMORY_TEXT_MAX + 1)).toBe(true);
  });
});
