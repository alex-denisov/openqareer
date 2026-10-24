import { describe, expect, it } from 'vitest';
import { calculateAnnualPayroll } from '../../../shared/taxCalculators';
import { relocationEconomyBreakdown } from './relocationEconomyBreakdown';

const cost = (amount: number) => ({
  amount,
  currency: 'EUR',
  period: 'monthly' as const,
  payer: 'candidate' as const,
  kind: 'candidate_estimate' as const,
  basis: 'Личная оценка кандидата',
  observedAt: '2026-10-01',
});

describe('relocationEconomyBreakdown (mockup 15 `view=net`)', () => {
  it('shows only the tax share from the country scale until expenses are entered', () => {
    const payroll = calculateAnnualPayroll('DE', 120_000);
    const view = relocationEconomyBreakdown(payroll, undefined);

    const tax = view.items.find(({ key }) => key === 'tax');
    expect(tax?.share).toBeGreaterThan(0);
    expect(view.items.find(({ key }) => key === 'rent')?.share).toBeNull();
    expect(view.items.find(({ key }) => key === 'insurance')?.share).toBeNull();
    expect(view.items.find(({ key }) => key === 'free')?.share).toBeNull();
    expect(view.freeMonthly).toBeNull();
    expect(view.netMonthly).toBe(payroll.netMonthlyIncome);
  });

  it('splits the gross into tax, rent, insurance, other costs and the free remainder from entered costs', () => {
    const payroll = calculateAnnualPayroll('DE', 120_000);
    const expenses = {
      rent: cost(1_500),
      insurance: cost(200),
      utilities: cost(250),
      food: cost(600),
      transport: cost(60),
      education: cost(0),
      other: cost(100),
    };
    const view = relocationEconomyBreakdown(payroll, expenses);
    const share = (key: string) => view.items.find((item) => item.key === key)?.share ?? NaN;

    expect(share('rent')).toBeCloseTo((1_500 * 12) / 120_000, 4);
    expect(share('insurance')).toBeCloseTo((200 * 12) / 120_000, 4);
    expect(share('other')).toBeCloseTo((1_010 * 12) / 120_000, 4);
    expect(share('tax') + share('rent') + share('insurance') + share('other') + share('free')).toBeCloseTo(1, 4);
    expect(view.freeMonthly).toBeCloseTo(payroll.netMonthlyIncome - 2_710, 2);
  });

  it('keeps the remainder unknown while any regular expense is missing', () => {
    const payroll = calculateAnnualPayroll('DE', 120_000);
    const view = relocationEconomyBreakdown(payroll, { rent: cost(1_500) });

    expect(view.items.find(({ key }) => key === 'rent')?.share).toBeCloseTo(0.15, 4);
    expect(view.items.find(({ key }) => key === 'free')?.share).toBeNull();
    expect(view.freeMonthly).toBeNull();
  });
});
