import { describe, expect, it } from 'vitest';
import { defaultSalaryCurrency } from './vacancyScreenCriteria';

/** CPO 26.10: у кандидата Москва и условие в ₽, а фильтр открывался с KZT (первой по алфавиту). */
describe('defaultSalaryCurrency', () => {
  it('takes the currency of the candidate conditions when the list has it', () => {
    expect(defaultSalaryCurrency(['EUR', 'KZT', 'RUB', 'USD'], 'RUB')).toBe('RUB');
    expect(defaultSalaryCurrency(['KZT', 'RUB'], 'RUR')).toBe('RUB');
  });

  it('falls back to the first listed currency otherwise', () => {
    expect(defaultSalaryCurrency(['KZT', 'USD'], 'RUB')).toBe('KZT');
    expect(defaultSalaryCurrency(['KZT', 'USD'], undefined)).toBe('KZT');
    expect(defaultSalaryCurrency([], 'RUB')).toBe('');
  });
});
