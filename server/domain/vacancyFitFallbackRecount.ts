import { createVacancyFitAssessor, type VacancyFitBulkClient } from './vacancyFitAssessor';
import { assessVacancyFit, type VacancyFitInput, type VacancyFitResult } from './vacancyFit';

/**
 * 05.11: one pass over the rows a fallback model answered. Models disagree on one input (33 / 4 / 37
 * on one vacancy), so each such row is asked of Vertex once. No loop: the mark is written before the
 * call and a marked row is never taken again; with no answer the old row stays as it was.
 */
export const FALLBACK_RECOUNT_TASK = 'vacancy-fit-fallback-recount';
export const FALLBACK_RECOUNT_DAY_USD = 2;
const GATE_PAUSE_MS = 60_000;
/** A timeout cools the gate for up to 5 minutes; past this a pass stops and may be started again. */
const GATE_WAITS = 10;
/** `onlyVertex` when the gate let no call out: nothing was asked or paid. */
const NOT_ASKED = 'Vertex gave no answer: no_stage';
const FAILURE_PREFIX = 'Vertex gave no answer: ';

export interface FallbackRecountRow {
  readonly key: string;
  readonly candidateId: string;
  readonly vacancyId: string;
}

export type VertexOnceOutcome =
  | { readonly kind: 'answered'; readonly result: VacancyFitResult; readonly answeredBy: string }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'no_answer'; readonly failure: string };

export interface FallbackRecountDeps {
  rows(): readonly FallbackRecountRow[];
  /** The input as the sweep builds it today, with today's requirements; undefined when it is gone. */
  resolve(row: FallbackRecountRow): VacancyFitInput | undefined;
  keyOf(resolved: VacancyFitInput): string;
  mark(row: FallbackRecountRow): void;
  release(row: FallbackRecountRow): void;
  ask(resolved: VacancyFitInput): Promise<VertexOnceOutcome>;
  write(resolved: VacancyFitInput, result: VacancyFitResult, answeredBy: string): void;
  /** What this task has spent today, from the ledger. */
  spentToday(): number;
  sleep(ms: number): Promise<void>;
}

export interface FallbackRecountReport {
  readonly rows: number;
  readonly answered: number;
  readonly noAnswer: number;
  readonly stale: number;
  readonly failures: Readonly<Record<string, number>>;
  readonly stopped: 'day_ceiling' | 'vertex_skipped' | null;
}

/** Vertex alone, one call: no repeat, no later stage, its own task in the ledger. */
export async function askVertexOnce(client: VacancyFitBulkClient, runId: string, resolved: VacancyFitInput): Promise<VertexOnceOutcome> {
  let answeredBy: string | null = null;
  let failure: unknown;
  const base = createVacancyFitAssessor({
    complete: async (request) => {
      const answer = await client.complete({ ...request, task: FALLBACK_RECOUNT_TASK, onlyVertex: true, patientVertex: false, firstLane: undefined });
      const { provider, model } = answer as { provider?: string; model?: string };
      answeredBy = provider && model ? `${provider} ${model}` : null;
      return answer;
    },
  }, runId);
  const result = await assessVacancyFit(resolved, {
    assess: async (request) => {
      try {
        return await base.assess(request);
      } catch (error) {
        failure = error;
        throw error;
      }
    },
  });
  if (failure === undefined && answeredBy) return { kind: 'answered', result, answeredBy };
  const message = failure instanceof Error ? failure.message : 'no_call';
  if (message === NOT_ASKED) return { kind: 'skipped' };
  // An unreadable answer quotes the profile: its class is named, the text is not kept.
  const name = message.startsWith(FAILURE_PREFIX) ? message.slice(FAILURE_PREFIX.length) : failure instanceof Error ? failure.name : 'no_call';
  return { kind: 'no_answer', failure: name };
}

export async function recountFallbackRows(deps: FallbackRecountDeps): Promise<FallbackRecountReport> {
  const rows = deps.rows();
  let answered = 0;
  let noAnswer = 0;
  let stale = 0;
  let failures: Readonly<Record<string, number>> = {};
  let waits = 0;
  const report = (stopped: FallbackRecountReport['stopped']): FallbackRecountReport => ({ rows: rows.length, answered, noAnswer, stale, failures, stopped });
  for (const row of rows) {
    const resolved = deps.resolve(row);
    if (!resolved || deps.keyOf(resolved) !== row.key) {
      stale += 1;
      continue;
    }
    for (;;) {
      if (deps.spentToday() >= FALLBACK_RECOUNT_DAY_USD) return report('day_ceiling');
      deps.mark(row);
      const outcome = await deps.ask(resolved);
      if (outcome.kind !== 'skipped') {
        if (outcome.kind === 'answered') {
          deps.write(resolved, outcome.result, outcome.answeredBy);
          answered += 1;
        } else {
          noAnswer += 1;
          failures = { ...failures, [outcome.failure]: (failures[outcome.failure] ?? 0) + 1 };
        }
        break;
      }
      deps.release(row);
      waits += 1;
      if (waits >= GATE_WAITS) return report('vertex_skipped');
      await deps.sleep(GATE_PAUSE_MS);
    }
  }
  return report(null);
}
