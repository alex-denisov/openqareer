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
  /** This step's own cap per UTC day. */
  readonly dayUsd: number;
  readonly dayCalls: number;
  /** The channel's caps (`readBulkLlmConfig`): the step yields before them. */
  readonly channelDayUsd: number;
  readonly channelMonthUsd: number;
  /** Share of the channel's day and month left to candidate-facing work. */
  readonly channelShare: number;
}

export const DEFAULT_CATALOG_RU_SUMMARY_LIMITS = {
  dayUsd: 1.5,
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

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The run of this step is one UTC day, like the vacancy-mechanics worker (`workerDayRunId`). */
export function catalogRuSummaryRunId(now: number): string {
  return `${CATALOG_RU_SUMMARY_TASK}:${utcDay(now)}`;
}

export class CatalogRuSummaryJob {
  private pausedUntil = 0;
  private running = false;

  constructor(
    private readonly options: {
      readonly store: CatalogRuSummaryStore;
      readonly client: Completion;
      readonly spend: CatalogRuSummarySpend;
      readonly limits: CatalogRuSummaryLimits;
      readonly now?: () => number;
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
    if (own.usd >= limits.dayUsd || own.calls >= limits.dayCalls) return 'own_cap';
    if (
      spend.channelDay(day) >= limits.channelDayUsd * limits.channelShare ||
      spend.channelMonth(`${day.slice(0, 7)}-01`) >= limits.channelMonthUsd * limits.channelShare
    )
      return 'channel_headroom';
    return undefined;
  }

  async step(): Promise<CatalogRuSummaryReport> {
    const empty = { written: 0, thin: 0, failed: 0, unchanged: 0 };
    if (this.running) return { ...empty, skipped: 'idle' };
    this.running = true;
    try {
      return await this.run(empty);
    } finally {
      this.running = false;
    }
  }

  private async run(tally: {
    written: number;
    thin: number;
    failed: number;
    unchanged: number;
  }): Promise<CatalogRuSummaryReport> {
    const now = this.now();
    const blocked = this.spendBlock(now);
    if (blocked) return { ...tally, skipped: blocked };
    const { store } = this.options;
    const candidates = store.candidates(now, CATALOG_RU_SUMMARY_VERSION, CANDIDATES_PER_TICK);
    if (candidates.length === 0) {
      // Nothing to do: the candidate query walks the catalog, so it is not repeated every tick.
      this.pausedUntil = now + IDLE_PAUSE_MS;
      return { ...tally, skipped: 'idle' };
    }
    for (const candidate of candidates) {
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
      // One model call a tick: the rest of the page waits for the next tick.
      return this.summarise(candidate, description, hash, now, tally);
    }
    return { ...tally };
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
      this.pausedUntil = now + OUTAGE_PAUSE_MS;
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
  return {
    task: (day) => {
      const row = read<{ usd: number; calls: number }>(
        `SELECT ${total} AS usd, count(*) AS calls FROM bulk_llm_spend WHERE task = ? AND day = ?`,
        { usd: 0, calls: 0 },
        CATALOG_RU_SUMMARY_TASK,
        day,
      );
      return { usd: Number(row.usd), calls: Number(row.calls) };
    },
    channelDay: (day) =>
      Number(
        read<{ usd: number }>(
          `SELECT ${total} AS usd FROM bulk_llm_spend WHERE day = ?`,
          { usd: 0 },
          day,
        ).usd,
      ),
    channelMonth: (monthStart) =>
      Number(
        read<{ usd: number }>(
          `SELECT ${total} AS usd FROM bulk_llm_spend WHERE day >= ?`,
          { usd: 0 },
          monthStart,
        ).usd,
      ),
  };
}
