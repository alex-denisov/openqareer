import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { loadBudgetState, saveBudgetState } from './linkedinBudgetState';
import { createLinkedinGuestBudget, LinkedinPaused } from './linkedinGuestBudget';

describe('linkedinBudgetState (B622)', () => {
  it('a pause survives a process restart', async () => {
    const db = new DatabaseSync(':memory:');
    expect(loadBudgetState(db)).toBeUndefined();
    let t = 1_000_000;
    const first = createLinkedinGuestBudget({
      now: () => t,
      onChange: (stats) => saveBudgetState(db, stats, new Date(t)),
    });
    first.markRateLimited();
    const saved = loadBudgetState(db)!;
    expect(saved.gapMs).toBe(8000);
    t += 60_000;
    const second = createLinkedinGuestBudget({ now: () => t, initial: saved });
    expect(second.isPaused()).toBe(true);
    await expect(second.acquire('companies')).rejects.toBeInstanceOf(LinkedinPaused);
    expect(second.stats().gapMs).toBe(8000);
  });
});
