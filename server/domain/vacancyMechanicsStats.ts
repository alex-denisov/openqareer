/** Worker counters for one journal line per batch (B524, B522). Error classes only, never text or ids. */
export interface VacancyMechanicsStats {
  requirementsDone: number;
  requirementsUnavailable: number;
  requirementsInvalid: number;
  claimed: number;
  completed: number;
  deferred: number;
  retried: number;
  failed: number;
  lastError: string | null;
  llmCalls: number;
  llmFailed: number;
  llmMs: number;
  lastModel: string | null;
  providers: string[];
}

export function emptyVacancyMechanicsStats(): VacancyMechanicsStats {
  return {
    requirementsDone: 0,
    requirementsUnavailable: 0,
    requirementsInvalid: 0,
    claimed: 0,
    completed: 0,
    deferred: 0,
    retried: 0,
    failed: 0,
    lastError: null,
    llmCalls: 0,
    llmFailed: 0,
    llmMs: 0,
    lastModel: null,
    providers: [],
  };
}

function modelPart(stats: VacancyMechanicsStats): string {
  if (stats.llmCalls === 0) return '';
  const extractions =
    stats.requirementsDone + stats.requirementsUnavailable + stats.requirementsInvalid;
  const failedShare = extractions
    ? Math.round(
        ((stats.requirementsUnavailable + stats.requirementsInvalid) / extractions) * 100,
      )
    : 0;
  return (
    ` | model=${stats.lastModel ?? 'unknown'} providers=${stats.providers.join(',') || 'unknown'} ` +
    `llm_calls=${stats.llmCalls} llm_failed=${stats.llmFailed} ` +
    `llm_avg_ms=${Math.round(stats.llmMs / stats.llmCalls)} ` +
    `extract_unavailable=${stats.requirementsUnavailable} extract_invalid=${stats.requirementsInvalid} ` +
    `extract_failed_share=${failedShare}%`
  );
}

/** null when nothing happened: an idle worker does not flood the journal. */
export function formatVacancyMechanicsStats(
  stats: VacancyMechanicsStats,
  periodMs: number,
): string | null {
  const total =
    stats.requirementsDone +
    stats.requirementsUnavailable +
    stats.requirementsInvalid +
    stats.claimed;
  if (total === 0) return null;
  const reason = stats.lastError ? ` last_error=${stats.lastError}` : '';
  return (
    `vacancy-mechanics batch ${Math.round(periodMs / 1000)}s: requirements=${stats.requirementsDone} ` +
    `fit_claimed=${stats.claimed} completed=${stats.completed} deferred=${stats.deferred} ` +
    `retried=${stats.retried} failed=${stats.failed}${reason}${modelPart(stats)}`
  );
}
