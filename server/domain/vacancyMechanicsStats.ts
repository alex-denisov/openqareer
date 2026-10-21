/** Worker counters for one journal line per batch (B524). Error classes only, never text or ids. */
export interface VacancyMechanicsStats {
  requirementsDone: number;
  claimed: number;
  completed: number;
  deferred: number;
  retried: number;
  failed: number;
  lastError: string | null;
}

export function emptyVacancyMechanicsStats(): VacancyMechanicsStats {
  return {
    requirementsDone: 0,
    claimed: 0,
    completed: 0,
    deferred: 0,
    retried: 0,
    failed: 0,
    lastError: null,
  };
}

/** null when nothing happened: an idle worker does not flood the journal. */
export function formatVacancyMechanicsStats(
  stats: VacancyMechanicsStats,
  periodMs: number,
): string | null {
  const total = stats.requirementsDone + stats.claimed;
  if (total === 0) return null;
  const reason = stats.lastError ? ` last_error=${stats.lastError}` : '';
  return (
    `vacancy-mechanics batch ${Math.round(periodMs / 1000)}s: requirements=${stats.requirementsDone} ` +
    `fit_claimed=${stats.claimed} completed=${stats.completed} deferred=${stats.deferred} ` +
    `retried=${stats.retried} failed=${stats.failed}${reason}`
  );
}
