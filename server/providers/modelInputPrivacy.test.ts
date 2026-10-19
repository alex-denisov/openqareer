import { describe, expect, it } from 'vitest';
import { minimizeModelText } from './modelInputPrivacy';

describe('bounded model input contact minimization', () => {
  it('removes contact channels while keeping the experience requirement', () => {
    expect(minimizeModelText('5 years TypeScript. person@example.test +7 (999) 123-45-67 https://example.test/profile'))
      .toBe('5 years TypeScript. [contact removed] [phone removed][link removed]');
  });
  it('keeps plain salary and years of experience as evidence', () => {
    expect(minimizeModelText('Salary 120000 USD; 8 years of experience.')).toBe('Salary 120000 USD; 8 years of experience.');
  });
});
