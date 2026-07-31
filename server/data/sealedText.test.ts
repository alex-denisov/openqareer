import { describe, expect, it } from 'vitest';
import { SealedText } from './sealedText';

describe('sealed candidate text', () => {
  it('round-trips with authenticated associated data', () => {
    const sealedText = new SealedText(Buffer.alloc(32, 9));
    const sealed = sealedText.seal(
      'Чувствительный карьерный факт',
      'candidate:a:message:1',
    );

    expect(sealed).not.toContain('Чувствительный');
    expect(
      sealedText.open(sealed, 'candidate:a:message:1'),
    ).toBe('Чувствительный карьерный факт');
    expect(() =>
      sealedText.open(sealed, 'candidate:b:message:1'),
    ).toThrow();
  });
});
