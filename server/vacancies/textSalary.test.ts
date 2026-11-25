import { describe, expect, it } from 'vitest';
import { salaryFromDescription, withTextSalary } from './textSalary';

describe('вилка из текста вакансии (Н3)', () => {
  it.each([
    ['Pay Range $240,000–280,000', 240_000, 280_000, 'USD'],
    ['<h3>Pay Range</h3><p>$240,000 - $280,000 USD</p>', 240_000, 280_000, 'USD'],
    [
      'The base pay range for this role is between $142,300 and $263,300, and',
      142_300,
      263_300,
      'USD',
    ],
    ['Salary Range: $119,800 - $182,700 annually', 119_800, 182_700, 'USD'],
    ['Base salary: £70k - £90k', 70_000, 90_000, 'GBP'],
    ['Compensation range: $150K–$200K', 150_000, 200_000, 'USD'],
  ])('%s', (text, from, to, currency) => {
    expect(salaryFromDescription(text)).toEqual({ from, to, currency });
  });

  it.each([
    'We raised $100,000 to $200,000 from investors',
    'Salary range: $40,736 to $56,844 in Quincy. Salary range: $46,105 to $56,844 in Carlsbad',
    'Base Pay Range: $175,760 - $197,004 - $221,970',
    'base salary range: $120,000 – $130,000, and can increase up to $172,500 - $182,500',
    'Salary range: CA$100,000 - CA$120,000',
    'Salary range: $100,000 - $120,000 CAD',
    'Pay range $30,000 - $40,000 per month',
    'Salary OTE $200,000 - $250,000',
    'Salary is competitive. Our customers manage $100,000 - $200,000',
  ])('не читается: %s', (text) => {
    expect(salaryFromDescription(text)).toBeUndefined();
  });

  it('вилка площадки остаётся', () => {
    const row = { salary: { from: 1, currency: 'USD' }, description: 'Pay Range $240,000–280,000' };
    expect(withTextSalary(row)).toBe(row);
  });

  it('доллар канадской вакансии валютой не называется', () => {
    const row = { title: 'Manager - Ottawa', description: 'Pay Range $75,000–85,000' };
    expect(withTextSalary(row)).toBe(row);
  });
});
