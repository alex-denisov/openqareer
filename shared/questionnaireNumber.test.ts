import { describe, expect, it } from 'vitest';
import { acceptedNumber, isBadNumber, nearestAccepted, numberRule } from './questionnaireNumber';

const limits = { min: 0, max: 50_000, step: 500, unit: '$' };

describe('число для поля формы', () => {
  it.each([
    ['5 000', 5000],
    ['5000', 5000],
    ['7300', null],
    ['60000', null],
    ['-500', null],
    ['от 5 000 $', null],
    ['', null],
  ])('%s → %s', (text, value) => expect(acceptedNumber(text, limits)).toBe(value));

  it('подсказка встаёт на шаг, вне границ её нет', () => {
    expect(nearestAccepted(7300, limits)).toBe(7500);
    expect(nearestAccepted(60_000, limits)).toBeNull();
    expect(nearestAccepted(7300)).toBe(7300);
  });

  it('правило называет границы; пустой и текстовый вопрос не ошибка', () => {
    expect(numberRule({ numeric: true, limits }).replace(/\s/gu, ' ')).toBe(
      'Число от 0 до 50 000 $, шаг 500',
    );
    expect(isBadNumber({ numeric: true, limits }, ' ')).toBe(false);
    expect(isBadNumber({}, 'от 5 000 $')).toBe(false);
    expect(isBadNumber({ numeric: true, limits }, 'от 5 000 $')).toBe(true);
  });
});
