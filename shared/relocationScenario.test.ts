import { describe, expect, it } from 'vitest';
import { calculateRelocationScenario, relocationScenarioInputSchema } from './relocationScenario';

const cost = (amount: number, period: 'monthly' | 'annual' | 'once' = 'monthly') => ({
  amount, period, currency: 'AED', payer: 'candidate', kind: 'candidate_estimate',
  basis: 'Моя оценка для Дубая', observedAt: '2026-10-19',
});
const complete = () => ({
  name: 'Дубай, один человек', countryCode: 'AE', city: 'Дубай', householdSize: 1,
  grossAnnualIncome: 120000, incomeMode: 'local_employment', scenarioId: 'employer_sponsorship',
  expenses: { rent: cost(24000, 'annual'), utilities: cost(200), food: cost(500),
    transport: cost(300), insurance: { ...cost(0), payer: 'employer' }, education: cost(0), other: cost(0) },
  upfront: { visa: cost(300, 'once'), moving: cost(1000, 'once'), deposit: cost(2000, 'once'), documents: cost(0, 'once'), travel: cost(0, 'once'), furnishings: cost(0, 'once') },
  proofOfFunds: cost(0, 'once'),
  visa: { hasJobOffer: true }, reserveMonths: 3,
});

describe('B468 complete relocation decision', () => {
  it('keeps an absent salary unknown instead of silently inventing zero', () => {
    const result = calculateRelocationScenario(relocationScenarioInputSchema.parse({ ...complete(), grossAnnualIncome: undefined }));
    expect(result.monthlyNetIncome).toBeNull();
    expect(result.monthlyRemaining).toBeNull();
    expect(result.payroll).toBeNull();
    expect(calculateRelocationScenario(relocationScenarioInputSchema.parse({ ...complete(), grossAnnualIncome: undefined, confirmedNetMonthly: cost(9999) })).monthlyNetIncome).toBeNull();
  });
  it('uses independently declared visa income currency and explicit family composition', () => {
    const ae = relocationScenarioInputSchema.parse({ ...complete(), scenarioId: 'digital_nomad', visa: { citizenshipCountryCodes: ['RU'], worksRemotelyForForeignEmployer: true, hasPrivateHealthInsurance: true, remoteMonthlyIncome: { amount: 3500, currency: 'USD' } } });
    expect(calculateRelocationScenario(ae).mobility?.status).toBe('available');
    const cy = relocationScenarioInputSchema.parse({ ...complete(), countryCode: 'CY', expenses: {}, upfront: {}, proofOfFunds: undefined, scenarioId: 'digital_nomad', visa: { citizenshipCountryCodes: ['RU'], worksRemotelyForForeignEmployer: true, hasPrivateHealthInsurance: true, remoteMonthlyIncomeIsNet: true, remoteMonthlyIncome: { amount: 5000, currency: 'EUR' }, family: { hasPartner: true, children: 1 } } });
    expect(calculateRelocationScenario(cy).mobility?.status).toBe('available');
    expect(calculateRelocationScenario({ ...cy, visa: { ...cy.visa, family: undefined } }).mobility?.status).toBe('unknown');
  });
  it('keeps proof-of-funds distinct from spending and converts only explicit sourced FX', () => {
    const input = relocationScenarioInputSchema.parse({ ...complete(), proofOfFunds: cost(5000, 'once'), comparisonRate: { ...cost(0.25, 'once'), currency: 'EUR' } });
    const result = calculateRelocationScenario(input);
    expect(result.requiredCash).toBe(17300);
    expect(result.comparisonMonthlyRemaining).toBe(1750);
    expect(calculateRelocationScenario({ ...input, proofFundsUsableForLiving: true }).requiredCash).toBe(12300);
    expect(() => calculateRelocationScenario({ ...input, comparisonRate: { ...input.comparisonRate!, amount: 0 } })).toThrow();
  });
  it('separates recurring costs, once-only spending, refundable deposit and runway', () => {
    const result = calculateRelocationScenario(relocationScenarioInputSchema.parse(complete()));
    expect(result.monthlyKnownCosts).toBe(3000);
    expect(result.monthlyRemaining).toBe(7000);
    expect(result.upfrontSpending).toBe(1300);
    expect(result.refundableDeposit).toBe(2000);
    expect(result.requiredCash).toBe(12300);
  });
  it('never turns a missing expense into zero or a complete budget', () => {
    const input = complete(); delete (input.expenses as Partial<typeof input.expenses>).rent;
    const result = calculateRelocationScenario(relocationScenarioInputSchema.parse(input));
    expect(result.missingCosts).toContain('rent');
    expect(result.monthlyRemaining).toBeNull();
    expect(result.requiredCash).toBeNull();
  });
  it('does not use local payroll rules for foreign remote or self-employed income', () => {
    const input = { ...complete(), incomeMode: 'self_employed' };
    const result = calculateRelocationScenario(relocationScenarioInputSchema.parse(input));
    expect(result.payroll).toBeNull();
    expect(result.monthlyRemaining).toBeNull();
    expect(result.incomeStatus).toBe('unknown');
  });
  it('rejects foreign-currency spending without explicit conversion and rejects negative costs', () => {
    const input = complete(); input.expenses.rent.currency = 'EUR';
    expect(() => calculateRelocationScenario(relocationScenarioInputSchema.parse(input))).toThrow(/валют/);
    expect(relocationScenarioInputSchema.safeParse({ ...complete(), grossAnnualIncome: -1 }).success).toBe(false);
  });
  it('does not treat visa-free entry as permission to work or infer sponsorship from salary', () => {
    const result = calculateRelocationScenario(relocationScenarioInputSchema.parse(complete()));
    expect(result.mobility?.status).not.toBe('available');
    expect(result.payroll?.assumptions.length).toBeGreaterThan(0);
    expect(result.taxSources.length).toBeGreaterThan(0);
  });
});
