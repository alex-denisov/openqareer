import { describe, expect, it } from 'vitest';
import { emptyVacancyMechanicsStats, formatVacancyMechanicsStats } from './vacancyMechanicsStats';

describe('vacancy mechanics batch journal line', () => {
  it('stays silent for an idle batch', () => {
    expect(formatVacancyMechanicsStats(emptyVacancyMechanicsStats(), 60_000)).toBeNull();
  });
  it('names counts and the failure class in one line', () => {
    const line = formatVacancyMechanicsStats(
      {
        ...emptyVacancyMechanicsStats(),
        requirementsDone: 2,
        claimed: 5,
        completed: 3,
        deferred: 1,
        failed: 1,
        lastError: 'requirements_wait_timeout',
      },
      61_000,
    );
    expect(line).toBe(
      'vacancy-mechanics batch 61s: requirements=2 fit_claimed=5 completed=3 deferred=1 retried=0 failed=1 last_error=requirements_wait_timeout',
    );
  });
});
