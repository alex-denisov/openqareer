import { describe, expect, it } from 'vitest';
import { compareMatchedVacancies, type OrderableMatch } from './vacancyMatchOrder';

/**
 * PRB-016: порядок больше не задаётся выдуманным баллом. Сравнивается только
 * измеримое — совпадение роли, доля покрытых требований, свежесть.
 */
describe('compareMatchedVacancies', () => {
  const entry = (
    roleMatch: OrderableMatch['explanation']['roleMatch'],
    requirements: OrderableMatch['explanation']['requirements'],
    firstObservedAt = '2026-09-01T00:00:00.000Z',
  ): OrderableMatch => ({
    cluster: { firstObservedAt },
    explanation: { roleMatch, requirements },
  });

  it('puts a target role above a partial one', () => {
    const order = [
      entry('partial', { matched: 5, total: 5 }),
      entry('target', { matched: 1, total: 5 }),
    ].sort(compareMatchedVacancies);
    expect(order[0].explanation.roleMatch).toBe('target');
  });

  it('orders equal roles by the share of requirements met', () => {
    const order = [
      entry('target', { matched: 1, total: 4 }),
      entry('target', { matched: 3, total: 4 }),
    ].sort(compareMatchedVacancies);
    expect(order[0].explanation.requirements?.matched).toBe(3);
  });

  it('keeps a vacancy that listed no requirements below one that did', () => {
    const order = [
      entry('target', undefined),
      entry('target', { matched: 1, total: 5 }),
    ].sort(compareMatchedVacancies);
    expect(order[0].explanation.requirements).toEqual({ matched: 1, total: 5 });
  });

  it('breaks a tie with the fresher record', () => {
    const order = [
      entry('none', { matched: 1, total: 2 }, '2026-08-01T00:00:00.000Z'),
      entry('none', { matched: 1, total: 2 }, '2026-09-02T00:00:00.000Z'),
    ].sort(compareMatchedVacancies);
    expect(order[0].cluster.firstObservedAt).toBe('2026-09-02T00:00:00.000Z');
  });

  it('ranks a vacancy with matched requirements (2/n) above 0/n in the target function tier (B296)', () => {
    const zeroOfN = {
      cluster: { firstObservedAt: '2026-09-01T00:00:00.000Z', isRemote: true },
      explanation: {
        roleMatch: 'target' as const,
        levelMatch: 'match' as const,
        requirements: { matched: 0, total: 5 },
      },
    };
    const twoOfN = {
      cluster: { firstObservedAt: '2026-09-01T00:00:00.000Z', isRemote: true },
      explanation: {
        roleMatch: 'partial' as const,
        levelMatch: 'match' as const,
        requirements: { matched: 2, total: 5 },
      },
    };
    const order = [zeroOfN, twoOfN].sort(compareMatchedVacancies);
    expect(order[0]).toBe(twoOfN);
  });

  it('places a vacancy with unextracted requirements (n = 0) between >= 1 matched and 0/n (B296)', () => {
    const matched = {
      cluster: { firstObservedAt: '2026-09-01T00:00:00.000Z', isRemote: true },
      explanation: {
        roleMatch: 'target' as const,
        levelMatch: 'match' as const,
        requirements: { matched: 2, total: 5 },
      },
    };
    const unextracted = {
      cluster: { firstObservedAt: '2026-09-01T00:00:00.000Z', isRemote: true },
      explanation: {
        roleMatch: 'target' as const,
        levelMatch: 'match' as const,
      },
    };
    const zeroMatches = {
      cluster: { firstObservedAt: '2026-09-01T00:00:00.000Z', isRemote: true },
      explanation: {
        roleMatch: 'target' as const,
        levelMatch: 'match' as const,
        requirements: { matched: 0, total: 5 },
      },
    };
    const order = [zeroMatches, unextracted, matched].sort(compareMatchedVacancies);
    expect(order).toEqual([matched, unextracted, zeroMatches]);
  });

  it('keeps distant offices below remote vacancies of the same target function even with matched requirements (B296)', () => {
    const remoteZero = {
      cluster: { firstObservedAt: '2026-09-01T00:00:00.000Z', isRemote: true },
      explanation: {
        roleMatch: 'target' as const,
        levelMatch: 'match' as const,
        requirements: { matched: 0, total: 5 },
      },
    };
    const distantWithMatches = {
      cluster: { firstObservedAt: '2026-09-01T00:00:00.000Z', isRemote: false },
      explanation: {
        roleMatch: 'target' as const,
        levelMatch: 'match' as const,
        outsideGeography: true,
        requirements: { matched: 3, total: 5 },
      },
    };
    const order = [distantWithMatches, remoteZero].sort(compareMatchedVacancies);
    expect(order[0]).toBe(remoteZero);
  });
});
