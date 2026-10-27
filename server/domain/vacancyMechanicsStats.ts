/** Worker counters for one journal line per batch (B524, B522). Error classes only, never text or ids. */
export interface VacancyMechanicsStats {
  requirementsDone: number;
  requirementsUnavailable: number;
  requirementsInvalid: number;
  /** Jobs returned to the queue because the spend budget refused the call (B556): not an extraction failure. */
  budgetPaused: number;
  /** Why model answers or their entries were not used (B510-r), by `ModelAnswerIssue`. */
  modelIssues: Record<string, number>;
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
  /** Calls answered by the reserve lane, and why OpenRouter was skipped last (27.10). */
  fallbackCalls: number;
  fallbackReason: string | null;
}

export function emptyVacancyMechanicsStats(): VacancyMechanicsStats {
  return {
    requirementsDone: 0,
    requirementsUnavailable: 0,
    requirementsInvalid: 0,
    budgetPaused: 0,
    modelIssues: {},
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
    fallbackCalls: 0,
    fallbackReason: null,
  };
}

function issuesPart(issues: Readonly<Record<string, number>>): string {
  const parts = Object.entries(issues)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([issue, count]) => `${issue}:${count}`);
  return parts.length ? ` extract_issues=${parts.join(',')}` : '';
}

function fallbackPart(stats: VacancyMechanicsStats): string {
  return stats.fallbackCalls
    ? ` fallback=gemini reason=${stats.fallbackReason ?? 'unknown'} fallback_calls=${stats.fallbackCalls}`
    : '';
}

function modelPart(stats: VacancyMechanicsStats): string {
  if (stats.llmCalls === 0) return '';
  const extractions =
    stats.requirementsDone + stats.requirementsUnavailable + stats.requirementsInvalid;
  const failedShare = extractions
    ? Math.round(((stats.requirementsUnavailable + stats.requirementsInvalid) / extractions) * 100)
    : 0;
  return (
    ` | model=${stats.lastModel ?? 'unknown'} providers=${stats.providers.join(',') || 'unknown'} ` +
    `llm_calls=${stats.llmCalls} llm_failed=${stats.llmFailed} ` +
    `llm_avg_ms=${Math.round(stats.llmMs / stats.llmCalls)} ` +
    `extract_unavailable=${stats.requirementsUnavailable} extract_invalid=${stats.requirementsInvalid} ` +
    `extract_failed_share=${failedShare}%${fallbackPart(stats)}${stats.budgetPaused ? ` extract_budget_paused=${stats.budgetPaused}` : ''}${issuesPart(stats.modelIssues)}`
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
