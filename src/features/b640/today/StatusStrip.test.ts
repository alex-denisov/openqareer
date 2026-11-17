import { describe, expect, it } from 'vitest';
import { progressLine } from './StatusStrip';

describe('b640 today: строка пути откликов', () => {
  it('ставит дату выбора статуса перед путём', () => {
    expect(progressLine('2026-10-02T09:00:00.000Z', '13 откликов → 1 интервью → 1 оффер')).toBe(
      'С 2 октября: 13 откликов → 1 интервью → 1 оффер',
    );
  });

  it('без даты оставляет только путь', () => {
    expect(progressLine(null, '1 отклик')).toBe('1 отклик');
    expect(progressLine(undefined, '1 отклик')).toBe('1 отклик');
    expect(progressLine('не дата', '1 отклик')).toBe('1 отклик');
  });
});
