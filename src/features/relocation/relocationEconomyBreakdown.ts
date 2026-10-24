import type { PayrollResult } from '../../../shared/taxCalculators';
import { RELOCATION_EXPENSES, type RelocationScenarioInput } from '../../../shared/relocationScenario';

export type EconomyItemKey = 'tax' | 'rent' | 'insurance' | 'other' | 'free';

export interface EconomyItem {
  readonly key: EconomyItemKey;
  readonly label: string;
  /** Share of the gross salary, or null when we have no verified number for it. */
  readonly share: number | null;
}

export interface EconomyBreakdown {
  readonly items: readonly EconomyItem[];
  readonly netMonthly: number;
  readonly freeMonthly: number | null;
}

type Expenses = RelocationScenarioInput['expenses'];

const OTHER_KEYS = RELOCATION_EXPENSES.filter((key) => key !== 'rent' && key !== 'insurance');

/** Monthly amount the candidate pays; employer-paid or included costs count as zero. */
function monthly(cost: Expenses[keyof Expenses]): number | null {
  if (!cost) return null;
  if (cost.payer !== 'candidate') return 0;
  return cost.period === 'annual' ? cost.amount / 12 : cost.amount;
}

/**
 * Mockup 15 `view=net`: taxes from the country scale, rent, insurance and the free remainder
 * only from the candidate's own scenario. Nothing is filled in by us.
 */
export function relocationEconomyBreakdown(
  payroll: PayrollResult,
  expenses: Expenses | undefined,
): EconomyBreakdown {
  const gross = payroll.grossAnnualIncome / 12;
  const share = (value: number | null) => (value === null || gross <= 0 ? null : value / gross);
  const rent = monthly(expenses?.rent);
  const insurance = monthly(expenses?.insurance);
  const others = OTHER_KEYS.map((key) => monthly(expenses?.[key]));
  const otherKnown = others.filter((value): value is number => value !== null);
  const other = otherKnown.length ? otherKnown.reduce((sum, value) => sum + value, 0) : null;
  const complete = rent !== null && insurance !== null && otherKnown.length === others.length;
  const freeMonthly = complete
    ? payroll.netMonthlyIncome - rent - insurance - (other ?? 0)
    : null;
  return {
    items: [
      { key: 'tax', label: 'Налоги и взносы', share: share(gross - payroll.netMonthlyIncome) },
      { key: 'rent', label: 'Аренда', share: share(rent) },
      { key: 'insurance', label: 'Страховка', share: share(insurance) },
      { key: 'other', label: 'Другие расходы', share: share(other) },
      { key: 'free', label: 'Свободный остаток', share: share(freeMonthly) },
    ],
    netMonthly: payroll.netMonthlyIncome,
    freeMonthly,
  };
}
