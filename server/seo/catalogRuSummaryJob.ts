/**
 * Maintenance-process step that writes the Russian card summaries
 * (`catalogRuSummary.ts`), one model call a tick, newest indexable cards first.
 *
 * Money: the call goes through the bulk channel (its ledger holds the run, day
 * and month caps and the overrun mark). On top of that this step keeps its own
 * day cap and leaves the channel's headroom to the candidate-facing work
 * (requirements and fit percent): it stops while the channel has spent most of
 * its day or month. A budget refusal pauses the step until the next UTC day.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  BULK_BUDGET_EXCEEDED,
  type BulkLlmInput,
  type BulkLlmResult,
} from '../providers/bulkLlmClient';
import {
  CATALOG_RU_SUMMARY_PROMPT,
  CATALOG_RU_SUMMARY_SOURCE_MIN,
  CATALOG_RU_SUMMARY_TASK,
  CATALOG_RU_SUMMARY_VERSION,
  catalogRuSummaryInput,
  catalogSummarySourceHash,
  parseCatalogRuSummary,
  type CatalogRuSummarySource,
} from './catalogRuSummary';
import {
  SUMMARY_MAX_ATTEMPTS,
  type CatalogRuSummaryCandidate,
  type CatalogRuSummaryStore,
} from './catalogRuSummaryStore';

export interface CatalogRuSummaryLimits {
  /** This step's own cap per UTC day, in OpenRouter money; Vertex has its own (`OPENQAREER_VERTEX_CATALOG_SUMMARY_DAY_USD`). */
  readonly dayUsd: number;
  readonly dayCalls: number;
  /** The channel's caps (`readBulkLlmConfig`): the step yields before them. */
  readonly channelDayUsd: number;
  readonly channelMonthUsd: number;
  /** Share of the channel's day and month left to candidate-facing work. */
  readonly channelShare: number;
}

export const DEFAULT_CATALOG_RU_SUMMARY_LIMITS = {
  dayUsd: 0.5,
  dayCalls: 3_000,
  channelShare: 0.75,
} as const;

/** What the bulk ledger has spent: this task today, the whole channel today and this month. */
export interface CatalogRuSummarySpend {
  task(day: string): { usd: number; calls: number };
  channelDay(day: string): number;
  channelMonth(monthStart: string): number;
}

export interface CatalogRuSummaryReport {
  readonly written: number;
  readonly thin: number;
  readonly failed: number;
  readonly unchanged: number;
  readonly skipped?: 'paused' | 'own_cap' | 'channel_headroom' | 'idle';
  readonly issue?: string;
  readonly model?: string;
  readonly costUsd?: number;
}

type Completion = { complete(input: BulkLlmInput): Promise<BulkLlmResult> };

const OUTAGE_PAUSE_MS = 10 * 60_000;
/** The bulk client's error when the last stage's answer failed `accept` (`bulkLlmClient.ts`). */
const BULK_ANSWER_REJECTED = 'Bulk answer rejected';
const IDLE_PAUSE_MS = 5 * 60_000;
/** Rows looked at per tick: unchanged rechecks are cheap, only one may cost a model call. */
const CANDIDATES_PER_TICK = 20;
/** 600 words of Russian fit in ~1 200 tokens; the cap keeps a runaway answer cheap. */
const SUMMARY_MAX_TOKENS = 1_500;
/**
 * Owner 08.11: the hh queue is closed on the last day of the Vertex credit, so until it ends a tick
 * sends several calls at once; afterwards one call a tick again, by the date alone.
 */
export const CATALOG_RU_SUMMARY_BOOST_UNTIL_MS = Date.parse('2026-11-09T00:00:00Z');
export const CATALOG_RU_SUMMARY_BOOST_CALLS = 16;

/**
 * One refused call of a 16-call pack paused the whole step for 10 min (08.11: ~290/h). Until the
 * credit ends the pause is a minute; the chain already falls back to OpenRouter per call.
 */
export function catalogRuSummaryOutagePauseMs(now: number): number {
  return now < CATALOG_RU_SUMMARY_BOOST_UNTIL_MS ? 60_000 : OUTAGE_PAUSE_MS;
}

export function catalogRuSummaryCallsPerTick(now: number): number {
  return now < CATALOG_RU_SUMMARY_BOOST_UNTIL_MS ? CATALOG_RU_SUMMARY_BOOST_CALLS : 1;
}

type Tally = { written: number; thin: number; failed: number; unchanged: number };

/** Reports of the calls of one tick as one: counts add up, the first pause or issue wins. */
function mergeReports(
  base: Tally,
  reports: readonly CatalogRuSummaryReport[],
): CatalogRuSummaryReport {
  const sum = (key: keyof Tally) => reports.reduce((total, r) => total + r[key], base[key]);
  const skipped = reports.find((r) => r.skipped)?.skipped;
  const issue = reports.find((r) => r.issue)?.issue;
  const model = reports.find((r) => r.model)?.model;
  const costs = reports.flatMap((r) => (r.costUsd === undefined ? [] : [r.costUsd]));
  return {
    written: sum('written'),
    thin: sum('thin'),
    failed: sum('failed'),
    unchanged: sum('unchanged'),
    ...(skipped ? { skipped } : {}),
    ...(issue ? { issue } : {}),
    ...(model ? { model } : {}),
    ...(costs.length > 0 ? { costUsd: costs.reduce((a, b) => a + b, 0) } : {}),
  };
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The run of this step is one UTC day, like the vacancy-mechanics worker (`workerDayRunId`). */
export function catalogRuSummaryRunId(now: number): string {
  return `${CATALOG_RU_SUMMARY_TASK}:${utcDay(now)}`;
}

export class CatalogRuSummaryJob {
  private pausedUntil = 0;
  /** Cards whose model call is running: steps overlap and fill free slots, not wait for a whole pack. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly options: {
      readonly store: CatalogRuSummaryStore;
      readonly client: Completion;
      readonly spend: CatalogRuSummarySpend;
      readonly limits: CatalogRuSummaryLimits;
      readonly now?: () => number;
      /** Model calls of one tick; by default by the date (`catalogRuSummaryCallsPerTick`). */
      readonly callsPerTick?: number;
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Why the step may not spend now, or undefined when it may. */
  private spendBlock(now: number): CatalogRuSummaryReport['skipped'] {
    if (now < this.pausedUntil) return 'paused';
    const { limits, spend } = this.options;
    const day = utcDay(now);
    const own = spend.task(day);
    // Until the Vertex credit ends the call count does not stop the step (08.11: 3 000 Gemini calls
    // closed it by 17 UTC); Vertex money has its own day cap in the Vertex gate.
    const callsCapped = own.calls >= limits.dayCalls && now >= CATALOG_RU_SUMMARY_BOOST_UNTIL_MS;
    if (own.usd >= limits.dayUsd || callsCapped) return 'own_cap';
    if (
      spend.channelDay(day) >= limits.channelDayUsd * limits.channelShare ||
      spend.channelMonth(`${day.slice(0, 7)}-01`) >= limits.channelMonthUsd * limits.channelShare
    )
      return 'channel_headroom';
    return undefined;
  }

  async step(): Promise<CatalogRuSummaryReport> {
    const empty = { written: 0, thin: 0, failed: 0, unchanged: 0 };
    const calls = this.options.callsPerTick ?? catalogRuSummaryCallsPerTick(this.now());
    if (this.inFlight.size >= calls) return { ...empty, skipped: 'idle' };
    return this.run(empty, calls - this.inFlight.size);
  }

  private async run(
    tally: {
      written: number;
      thin: number;
      failed: number;
      unchanged: number;
    },
    free: number,
  ): Promise<CatalogRuSummaryReport> {
    const now = this.now();
    const blocked = this.spendBlock(now);
    if (blocked) return { ...tally, skipped: blocked };
    const { store } = this.options;
    const candidates = store.candidates(
      now,
      CATALOG_RU_SUMMARY_VERSION,
      CANDIDATES_PER_TICK + this.inFlight.size,
    );
    if (candidates.length === 0) {
      // Nothing to do: the candidate query walks the catalog, so it is not repeated every tick.
      this.pausedUntil = now + IDLE_PAUSE_MS;
      return { ...tally, skipped: 'idle' };
    }
    const due: { candidate: CatalogRuSummaryCandidate; description: string; hash: string }[] = [];
    for (const candidate of candidates) {
      if (due.length >= free) break;
      if (this.inFlight.has(candidate.clusterId)) continue;
      const description = store.sourceText(candidate);
      const hash = catalogSummarySourceHash(candidate.title, description);
      const stored = candidate.stored;
      const sameText = stored?.sourceHash === hash && stored.version === CATALOG_RU_SUMMARY_VERSION;
      const retryDue =
        stored?.status === 'failed' &&
        stored.attempts < SUMMARY_MAX_ATTEMPTS &&
        stored.nextAttemptMs <= now;
      if (sameText && !retryDue) {
        store.touch(candidate.clusterId, now);
        tally.unchanged += 1;
        continue;
      }
      if (description.length < CATALOG_RU_SUMMARY_SOURCE_MIN) {
        store.saveThin(candidate.clusterId, hash, CATALOG_RU_SUMMARY_VERSION, now);
        tally.thin += 1;
        continue;
      }
      // Model calls are capped per tick: the rest of the page waits for the next tick.
      due.push({ candidate, description, hash });
    }
    if (due.length === 0) return { ...tally };
    return mergeReports(tally, await this.launch(due, now));
  }

  /** The cards' calls at once; each frees its slot as soon as it ends. */
  private async launch(
    due: readonly { candidate: CatalogRuSummaryCandidate; description: string; hash: string }[],
    now: number,
  ): Promise<CatalogRuSummaryReport[]> {
    const zero = { written: 0, thin: 0, failed: 0, unchanged: 0 };
    for (const item of due) this.inFlight.add(item.candidate.clusterId);
    return Promise.all(
      due.map(async (item) => {
        try {
          return await this.summarise(item.candidate, item.description, item.hash, now, {
            ...zero,
          });
        } finally {
          this.inFlight.delete(item.candidate.clusterId);
        }
      }),
    );
  }

  private async summarise(
    candidate: CatalogRuSummaryCandidate,
    description: string,
    hash: string,
    now: number,
    tally: { written: number; thin: number; failed: number; unchanged: number },
  ): Promise<CatalogRuSummaryReport> {
    const { store } = this.options;
    const source: CatalogRuSummarySource = {
      title: candidate.title,
      company: candidate.company,
      ...(candidate.location ? { location: candidate.location } : {}),
      isRemote: candidate.isRemote,
      description,
    };
    const fail = (issue: string, model?: string): CatalogRuSummaryReport => {
      store.saveFailed(
        candidate.clusterId,
        hash,
        CATALOG_RU_SUMMARY_VERSION,
        candidate.stored,
        now,
      );
      return { ...tally, failed: tally.failed + 1, issue, ...(model ? { model } : {}) };
    };
    const result = await this.complete(source, now);
    if (result === 'paused') return { ...tally, skipped: 'paused' };
    if (result === 'unavailable') {
      // An outage is not the card's fault: no attempt is spent, the step waits instead.
      this.pausedUntil = now + catalogRuSummaryOutagePauseMs(now);
      return { ...tally, issue: 'model_unavailable', skipped: 'paused' };
    }
    if ('rejected' in result) return fail(result.rejected);
    const parsed = parseCatalogRuSummary(result.content, source);
    if ('issue' in parsed) return fail(parsed.issue, result.model);
    store.saveReady(
      candidate.clusterId,
      hash,
      CATALOG_RU_SUMMARY_VERSION,
      parsed.summary,
      result.model,
      now,
    );
    return {
      ...tally,
      written: tally.written + 1,
      model: result.model,
      costUsd: result.usage.cost,
    };
  }

  /** One call of the bulk chain; a budget refusal pauses the step until the next UTC day. */
  private async complete(
    source: CatalogRuSummarySource,
    now: number,
  ): Promise<BulkLlmResult | 'paused' | 'unavailable' | { readonly rejected: string }> {
    let lastIssue = 'answer_rejected';
    try {
      return await this.options.client.complete({
        runId: catalogRuSummaryRunId(now),
        task: CATALOG_RU_SUMMARY_TASK,
        dataClass: 'public',
        prefix: CATALOG_RU_SUMMARY_PROMPT,
        input: catalogRuSummaryInput(source),
        maxTokens: SUMMARY_MAX_TOKENS,
        // An unusable answer moves the call to the next stage of the chain.
        accept: (content) => {
          const parsed = parseCatalogRuSummary(content, source);
          if ('issue' in parsed) lastIssue = parsed.issue;
          return 'summary' in parsed;
        },
      });
    } catch (error: unknown) {
      // Every stage answered and no answer passed the checks: the card's attempt, not an outage.
      if (error instanceof Error && error.message.startsWith(BULK_ANSWER_REJECTED)) {
        return { rejected: lastIssue };
      }
      if (!(error instanceof Error) || error.message !== BULK_BUDGET_EXCEEDED) return 'unavailable';
      const date = new Date(now);
      this.pausedUntil = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
      return 'paused';
    }
  }
}

/** The bulk ledger's table read on the shared database; before its first call there is none. */
export function sqliteCatalogRuSummarySpend(database: DatabaseSync): CatalogRuSummarySpend {
  const read = <T>(sql: string, fallback: T, ...values: string[]): T => {
    try {
      return (database.prepare(sql).get(...values) as T | undefined) ?? fallback;
    } catch (error: unknown) {
      if (error instanceof Error && /no such table/u.test(error.message)) return fallback;
      throw error;
    }
  };
  const total = 'COALESCE(SUM(COALESCE(cost, reserved)), 0)';
  // `provider='gemini'` (Vertex, 04.11) has its own caps in the Vertex gate; the dollars here are OpenRouter's.
  const openRouterTotal = `COALESCE(SUM(CASE WHEN provider <> 'gemini' THEN COALESCE(cost, reserved) END), 0)`;
  return {
    task: (day) => {
      const row = read<{ usd: number; calls: number }>(
        `SELECT ${openRouterTotal} AS usd, count(*) AS calls FROM bulk_llm_spend WHERE task = ? AND day = ?`,
        { usd: 0, calls: 0 },
        CATALOG_RU_SUMMARY_TASK,
        day,
      );
      return { usd: Number(row.usd), calls: Number(row.calls) };
    },
    channelDay: (day) =>
      Number(
        read<{ usd: number }>(
          `SELECT ${total} AS usd FROM bulk_llm_spend WHERE day = ? AND provider <> 'gemini'`,
          { usd: 0 },
          day,
        ).usd,
      ),
    channelMonth: (monthStart) =>
      Number(
        read<{ usd: number }>(
          `SELECT ${total} AS usd FROM bulk_llm_spend WHERE day >= ? AND provider <> 'gemini'`,
          { usd: 0 },
          monthStart,
        ).usd,
      ),
  };
}
