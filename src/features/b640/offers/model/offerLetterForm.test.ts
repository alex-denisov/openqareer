import { describe, expect, it } from 'vitest';
import { emptyOfferForm, parseOfferForm } from './offerForm';
import { applyLetter } from './offerLetterForm';

describe('applyLetter (B646)', () => {
  it('fills the fields found in the letter and names them', () => {
    const result = applyLetter(
      { ...emptyOfferForm(), risks: 'Премия не гарантирована', tax: '13' },
      {
        baseSalary: 520_000,
        salaryPeriod: 'month',
        currency: 'RUB',
        net: true,
        probationPeriodMonths: 3,
        probationSalary: 500_000,
        bonus: 1_040_000,
        format: 'hybrid',
        benefits: ['ДМС со стоматологией', 'оплата спорта'],
        startDate: '2026-12-01',
        respondBy: '2026-11-14',
      },
    );
    expect(result.form).toMatchObject({
      base: '520 000',
      period: 'month',
      currency: 'RUB',
      tax: '0',
      bonus: '1 040 000',
      format: 'hybrid',
      respondBy: '14.11.2026',
      probationMonths: '3',
      probationSalary: '500 000',
      benefits: 'ДМС со стоматологией, оплата спорта',
      startDate: '2026-12-01',
      risks: 'Премия не гарантирована',
    });
    expect([...result.fromLetter].sort()).toEqual(
      [
        'base',
        'benefits',
        'bonus',
        'currency',
        'format',
        'period',
        'probationMonths',
        'probationSalary',
        'respondBy',
        'tax',
      ].sort(),
    );
  });

  it('a gross salary keeps the tax the candidate typed', () => {
    const result = applyLetter(
      { ...emptyOfferForm(), tax: '13' },
      { baseSalary: 350_000, salaryPeriod: 'month', currency: 'RUB', net: false },
    );
    expect(result.form.tax).toBe('13');
    expect(result.fromLetter.has('tax')).toBe(false);
  });

  it('nothing found leaves the form as it was', () => {
    const form = { ...emptyOfferForm(), base: '100' };
    const result = applyLetter(form, {});
    expect(result.form).toEqual(form);
    expect(result.fromLetter.size).toBe(0);
  });

  it('the start date from the letter is saved with the terms', () => {
    const result = applyLetter(
      { ...emptyOfferForm(), company: 'А', title: 'Б' },
      { startDate: '2026-12-01' },
    );
    const parsed = parseOfferForm(result.form, true);
    expect(parsed.ok && parsed.terms.startDate).toBe('2026-12-01');
  });
});
