import { describe, expect, it } from 'vitest';
import {
  COST_SECTIONS,
  costsSummary,
  householdOf,
  whoLabel,
  type CostValues,
} from './relocationCostsModel';

describe('relocationCostsModel', () => {
  it('names who goes from the family answer', () => {
    expect(whoLabel(null)).toBe('только вы');
    expect(whoLabel({ partner: false, children: 0 })).toBe('только вы');
    expect(whoLabel({ partner: true, children: 0 })).toBe('вы и партнёр');
    expect(whoLabel({ partner: true, children: 2 })).toBe('вы, партнёр и 2 ребёнка');
    expect(whoLabel({ partner: false, children: 1 })).toBe('вы и 1 ребёнок');
    expect(householdOf({ partner: true, children: 2 })).toBe(4);
    expect(householdOf(null)).toBe(1);
  });

  it('counts missing sections and keeps the remainder until all monthly sections are filled', () => {
    const some: CostValues = { rent: 120_000, food: 60_000 };
    const partial = costsSummary(some, 424_022);
    expect(partial.missing).toBe(COST_SECTIONS.length - 2);
    expect(partial.remaining).toBeNull();
    expect(partial.startCash).toBeNull();
  });

  it('gives the remainder and the cash needed at start when every section is filled', () => {
    const all: CostValues = {
      rent: 120_000,
      utilities: 10_000,
      food: 60_000,
      transport: 5_000,
      insurance: 8_000,
      education: 0,
      other: 7_000,
      moving: 150_000,
      deposit: 120_000,
    };
    const summary = costsSummary(all, 424_022);
    expect(summary.missing).toBe(0);
    expect(summary.remaining).toBe(424_022 - 210_000);
    expect(summary.startCash).toBe(150_000 + 120_000 + 3 * 210_000);
  });
});
