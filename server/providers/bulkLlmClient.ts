import { z } from 'zod';
import type { BulkLlmConfig, BulkOpenRouterLane } from './bulkLlmConfig';
import { MODEL_CHAINS } from './modelChains';
import type { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { maskFailureText, providerFailureText } from './failureReason';
import { openRouterReasoning } from './openRouterReasoning';
/** The ledger refused a reservation: a spend limit, not a provider or answer failure (B556). */
export const BULK_BUDGET_EXCEEDED = 'Bulk budget exceeded';

/**
 * No stage of the chain could answer: nothing is wrong with the job. It waits in its queue and
 * spends no attempt, so a candidate sees «считаем» and the percent comes by itself afterwards.
 */
export class BulkChannelUnavailable extends Error {
  constructor(readonly reason: string) {
    super(`Bulk channel unavailable: ${reason}`);
  }
}

export interface BulkLlmInput {
  runId: string;
  task: string;
  dataClass: 'public' | 'candidate';
  prefix: string;
  input: string;
  maxTokens?: number;
  /**
   * Whether an answer is usable; an unusable one moves the call to the next stage of the chain.
   * Default: the answer is JSON (every bulk task asks for JSON).
   */
  accept?: (content: string) => boolean;
}
export interface BulkLlmUsage {
  cost: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}
export interface BulkLlmResult {
  content: string;
  model: string;
  provider: string;
  usage: BulkLlmUsage;
  /** Set when the answer came from a repeat or a later stage: why the head was skipped (`openrouter_503`). */
  fallbackReason?: string;
}
/** A switch of the channel to a later stage, for the worker journal and the owner alert. */
export interface BulkLlmChannelEvent {
  kind: 'fallback' | 'balance_exhausted' | 'channel_down';
  reason: string;
}
export interface BulkLlmClientOptions {
  now?: () => number;
  /** [0, 1): the jitter of a repeat's pause; tests fix it. */
  random?: () => number;
  onEvent?: (event: BulkLlmChannelEvent) => void;
}
/** A stage that had an outage is probed again no more often than this (27.10 incident). */
export const PRIMARY_RETRY_AFTER_MS = 10 * 60_000;
/** Calls of one stage for a network failure, a 5xx or a host's failure before the next stage. */
export const STAGE_ATTEMPTS = 3;
/**
 * Paid calls of one stage for an unusable answer. At temperature 0 the same host repeats itself,
 * so the second call goes to the next pinned host and a third would buy the same answer again.
 */
export const STAGE_PAID_ATTEMPTS = 2;
const RETRY_BASE_MS = 1_000;
/** 4 096 tokens at ~50 tokens/s (StreamLake 04.11: 58) plus its queue; 60 s cut the long answers. */
const REQUEST_TIMEOUT_MS = 120_000;
/** No stage or repeat starts after this: a job's lease is 300 s and must outlive the whole call. */
const CALL_DEADLINE_MS = 170_000;
/** Longer than a deploy or a provider's blip: then the owner hears about it. */
export const CHANNEL_DOWN_ALERT_MS = 30 * 60_000;
/** Outages worth cooling a stage for: no balance, rate limit after retries, server errors. */
function isOutage(status: number): boolean {
  return status === 402 || status === 429 || status >= 500;
}
function transportReason(prefix: string, error: unknown): string {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? `${prefix}_timeout`
    : `${prefix}_network`;
}
/** A stage failure: `outage` cools the stage, any failure moves the call to the next stage. */
class BulkStageError extends Error {
  constructor(
    readonly reason: string,
    readonly outage: boolean,
    message: string,
  ) {
    super(message);
  }
}
/** Money is uncertain or a cap is hit: the chain stops, no later stage is asked. */
class BulkSpendError extends Error {}
const UNKNOWN_USAGE = 'Unknown bulk usage; reservation retained';

function isJsonAnswer(content: string): boolean {
  const trimmed = content.trim();
  const body = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)?.[1] ?? trimmed;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * A network failure, a 5xx and a host's failure may pass. A call that ran out its 120 s would do it
 * again, so it goes to the next stage; any other status repeats itself.
 */
function isRepeatable(error: BulkStageError): boolean {
  return /_(network|upstream)$|_5\d\d$/u.test(error.reason);
}
function bodyFailureReason(error: unknown): string {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? 'openrouter_body_timeout'
    : 'openrouter_network';
}
/** The message of a 200 that carries a provider's error instead of an answer. */
function upstreamError(body: unknown): string | undefined {
  const parsed = z
    .object({ error: z.object({ message: z.string().optional() }), usage: z.undefined().optional() })
    .safeParse(body);
  return parsed.success
    ? maskFailureText(`upstream: ${parsed.data.error.message ?? 'no message'}`)
    : undefined;
}

const usageSchema = z.object({
  usage: z.object({
    cost: z.number().finite().nonnegative(),
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z
      .object({ cached_tokens: z.number().int().nonnegative().optional() })
      .optional(),
  }),
});
const completionSchema = z.object({
  model: z.string(),
  provider: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })),
});
const batchSchema = z.object({
  id: z.string().optional(),
  status: z.string(),
  model: z.string().optional(),
  provider: z.string().optional(),
  results: z.array(z.unknown()).optional(),
});
function parseUsage(body: unknown): BulkLlmUsage {
  const result = usageSchema.safeParse(body);
  if (!result.success) throw new Error('Unknown bulk usage; reservation retained');
  const u = result.data.usage;
  return {
    cost: u.cost,
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}
export class BulkLlmClient {
  constructor(
    private readonly config: BulkLlmConfig,
    private readonly ledger: SqliteBulkLlmLedger,
    private readonly transport: typeof fetch = fetch,
    private readonly delay: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly options: BulkLlmClientOptions = {},
  ) {
    this.stages = MODEL_CHAINS.bulk.flatMap((stage) => {
      const lane = config.lanes.find((item) => item.model === stage.model);
      return lane ? [lane] : [];
    });
  }
  private readonly stages: readonly BulkOpenRouterLane[];
  private readonly down = new Map<string, { until: number; reason: string }>();
  private unavailableSince: number | undefined;
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  /** Stages of the chain in order, cooling ones left out; all of them when every one cools. */
  private openStages(): readonly BulkOpenRouterLane[] {
    const open = this.stages.filter((lane) => (this.down.get(lane.model)?.until ?? 0) <= this.now());
    return open.length > 0 ? open : this.stages;
  }
  private validate(input: BulkLlmInput): number {
    if (
      !['public', 'candidate'].includes(input.dataClass) ||
      !input.runId ||
      !input.task ||
      input.runId.length > 128 ||
      input.task.length > 128
    )
      throw new Error('Invalid bulk input');
    const maxTokens = input.maxTokens ?? 2048;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192)
      throw new Error('Invalid maxTokens');
    return maxTokens;
  }
  /** `attempt`: a repeat starts from the next pinned host. */
  private body(input: BulkLlmInput, lane: BulkOpenRouterLane, attempt = 0) {
    const maxTokens = this.validate(input);
    const providers = lane.provider.split(',');
    const first = attempt % providers.length;
    const inputUpperBound = Buffer.byteLength(input.prefix) + Buffer.byteLength(input.input) + 4096;
    const costUpperBound =
      (inputUpperBound * lane.inputPerMillionUsd + maxTokens * lane.outputPerMillionUsd) / 1e6;
    if (inputUpperBound > 2_000_000 || costUpperBound > this.config.perRequestUsd)
      throw new Error('Request exceeds reserved budget');
    return {
      model: lane.model,
      messages: [
        { role: 'system', content: input.prefix },
        { role: 'user', content: input.input },
      ],
      max_tokens: maxTokens,
      // 02.11: one fit input gave 25 % and 58 %. Every pinned host takes `temperature`; not every
      // one takes `seed` (streamlake), and `require_parameters` would drop it.
      temperature: 0,
      reasoning: openRouterReasoning(lane.model),
      usage: { include: true },
      provider: {
        // Список закреплённых провайдеров по порядку: цена или лимит одного не останавливают работу.
        order: [...providers.slice(first), ...providers.slice(0, first)],
        only: providers,
        allow_fallbacks: providers.length > 1,
        require_parameters: true,
        data_collection: 'deny',
        quantizations: [lane.quantization],
        max_price: {
          prompt: lane.inputPerMillionUsd,
          completion: lane.outputPerMillionUsd,
        },
      },
    };
  }
  private async request(path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.transport(`https://openrouter.ai/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 429 || attempt === 2) return response;
      const seconds = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      await this.delay(
        Number.isFinite(seconds)
          ? Math.max(100, Math.min(seconds * 1000, 5000))
          : 500 * (attempt + 1),
      );
    }
    throw new Error('Unreachable');
  }
  /**
   * The bulk chain (`MODEL_CHAINS.bulk`, owner 04.11): deepseek-v4-flash, then glm-5.3-flash. A failed
   * call repeats on the stage with a pause and the next pinned host before the next stage is asked.
   * No stage left: `BulkChannelUnavailable`, the job waits. A spend cap or an uncertain charge stops at once.
   */
  async complete(input: BulkLlmInput): Promise<BulkLlmResult> {
    this.validate(input);
    if (this.stages.length === 0) throw new Error('Bulk chain has no stages');
    const startedAt = this.now();
    const accept = input.accept ?? isJsonAnswer;
    let failure: BulkStageError | undefined;
    let rejected: Error | undefined;
    for (const lane of this.openStages()) {
      if (this.now() - startedAt > CALL_DEADLINE_MS) break;
      const outcome = await this.askStage(lane, input, accept, startedAt);
      if (outcome.result) {
        this.unavailableSince = undefined;
        const fallbackReason =
          failure?.reason ?? outcome.failure?.reason ?? (rejected || outcome.rejected ? 'answer_rejected' : undefined);
        return fallbackReason ? { ...outcome.result, fallbackReason } : outcome.result;
      }
      rejected = outcome.rejected ?? rejected;
      failure = outcome.failure ?? failure;
    }
    // A stage's own answer was unusable: the job's to count, not an outage.
    if (rejected) throw rejected;
    throw this.channelDown(failure?.reason ?? 'no_stage');
  }

  /** One stage: repeats until it answers, runs out of attempts or the call runs out of time. */
  private async askStage(
    lane: BulkOpenRouterLane,
    input: BulkLlmInput,
    accept: (content: string) => boolean,
    startedAt: number,
  ): Promise<{ result?: BulkLlmResult; rejected?: Error; failure?: BulkStageError }> {
    let paid = 0;
    let failure: BulkStageError | undefined;
    let rejected: Error | undefined;
    for (let attempt = 0; attempt < STAGE_ATTEMPTS && paid < STAGE_PAID_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        if (this.now() - startedAt > CALL_DEADLINE_MS) break;
        await this.delay(this.pauseBefore(attempt));
      }
      try {
        const result = await this.completeOpenRouter(lane, input, attempt);
        this.down.delete(lane.model);
        if (accept(result.content)) return { result, rejected, failure };
        this.ledger.event('answer_rejected_openrouter');
        rejected = new Error(`Bulk answer rejected (${lane.model})`);
        paid += 1;
      } catch (error) {
        if (!(error instanceof BulkStageError)) throw error;
        this.ledger.event(`fallback_${error.reason}`);
        if (error.reason === 'openrouter_invalid') {
          // Billed and unusable: the same paid limit as an answer the caller rejected.
          rejected = new Error(`Bulk answer rejected (${lane.model})`);
          paid += 1;
        } else {
          failure = error;
          if (!isRepeatable(error)) break;
        }
      }
    }
    if (failure?.outage) this.cool(lane, failure.reason);
    return { rejected, failure };
  }

  /** 1 s, then 2 s, each from half to the whole of it: lanes that failed together do not return together. */
  private pauseBefore(attempt: number): number {
    const random = this.options.random ?? Math.random;
    return Math.round(RETRY_BASE_MS * 2 ** (attempt - 1) * (0.5 + random() / 2));
  }

  private channelDown(reason: string): BulkChannelUnavailable {
    this.unavailableSince ??= this.now();
    if (this.now() - this.unavailableSince >= CHANNEL_DOWN_ALERT_MS) {
      this.options.onEvent?.({ kind: 'channel_down', reason });
    }
    return new BulkChannelUnavailable(reason);
  }

  private cool(lane: BulkOpenRouterLane, reason: string) {
    this.down.set(lane.model, { until: this.now() + PRIMARY_RETRY_AFTER_MS, reason });
    this.options.onEvent?.({ kind: 'fallback', reason });
    if (reason === 'openrouter_402') this.options.onEvent?.({ kind: 'balance_exhausted', reason });
  }
  private async completeOpenRouter(
    lane: BulkOpenRouterLane,
    input: BulkLlmInput,
    attempt = 0,
  ): Promise<BulkLlmResult> {
    const body = this.body(input, lane, attempt);
    const id = this.ledger.reserve({ ...input, model: lane.model, provider: lane.provider }, this.config);
    if (!id) throw new Error(BULK_BUDGET_EXCEEDED);
    let response: Response;
    try {
      response = await this.request('/chat/completions', body);
    } catch (error) {
      // No answer came back: nothing was billed, so the hold is freed at once.
      const reason = transportReason('openrouter', error);
      this.ledger.release(id, reason);
      this.ledger.event('completion_failed_or_unknown');
      throw new BulkStageError(reason, true, error instanceof Error ? error.message : reason);
    }
    if (!response.ok) {
      this.ledger.release(id, await providerFailureText(response));
      throw new BulkStageError(
        `openrouter_${response.status}`,
        isOutage(response.status),
        `Bulk provider status ${response.status}`,
      );
    }
    return this.settleOpenRouter(id, lane, response);
  }
  private async settleOpenRouter(
    id: string,
    lane: BulkOpenRouterLane,
    response: Response,
  ): Promise<BulkLlmResult> {
    let result: unknown;
    try {
      result = await response.json();
    } catch (error) {
      // 200 came at once and the body never finished. Prod 04.11: such calls (631 November rows
      // held at $0.01) were billed $0.6 at most, so the hold is freed.
      const reason = bodyFailureReason(error);
      this.ledger.release(id, reason);
      this.ledger.event('completion_failed_or_unknown');
      throw new BulkStageError(reason, false, reason);
    }
    const upstream = upstreamError(result);
    if (upstream) {
      // OpenRouter reports a host's failure as 200 with `error` and no usage: nothing to bill.
      this.ledger.release(id, upstream);
      this.ledger.event('completion_failed_or_unknown');
      throw new BulkStageError('openrouter_upstream', false, upstream);
    }
    try {
      const usage = parseUsage(result);
      const actual = z
        .object({ model: z.string().optional(), provider: z.string().optional() })
        .parse(result);
      // A charge above the hold is booked at its real price; the paid answer is kept (B580).
      this.ledger.settle(id, usage, actual);
      const completion = completionSchema.safeParse(result);
      const content = completion.success ? completion.data.choices[0]?.message.content : undefined;
      // OpenRouter may answer with a dated revision of the pinned model, never with another model.
      if (!completion.success || !content || !completion.data.model.startsWith(lane.model))
        throw new BulkStageError('openrouter_invalid', false, 'Invalid bulk completion');
      return {
        content,
        model: completion.data.model,
        provider: completion.data.provider ?? lane.provider,
        usage,
      };
    } catch (error) {
      this.ledger.event('completion_failed_or_unknown');
      if (error instanceof BulkStageError || error instanceof BulkSpendError) throw error;
      // The charge could not be read: the hold stays, and no later stage is asked.
      throw new BulkSpendError(UNKNOWN_USAGE);
    }
  }
  /** Batches go to the first OpenRouter lane: only public inputs, no reserve lane. */
  private get batchLane(): BulkOpenRouterLane {
    const lane = this.config.lanes[0];
    if (!lane) throw new Error('Bulk chain has no OpenRouter lane');
    return lane;
  }
  async submitBatch(inputs: BulkLlmInput[]): Promise<{ reservationId: string; batchId: string }> {
    if (!this.config.batchEnabled) throw new Error('Batch endpoint eligibility not enabled');
    if (
      inputs.length < 1 ||
      inputs.length > 100 ||
      inputs.some((i) => i.dataClass !== 'public' || i.runId !== inputs[0].runId)
    )
      throw new Error('Batch requires public inputs from one run');
    const lane = this.batchLane;
    const requests = inputs.map((input, index) => ({
      custom_id: String(index),
      body: this.body(input, lane),
    }));
    const id = this.ledger.reserve(
      { ...inputs[0], model: lane.model, provider: lane.provider },
      this.config,
      inputs.length * this.config.perRequestUsd,
    );
    if (!id) throw new Error(BULK_BUDGET_EXCEEDED);
    try {
      const response = await this.request('/batches', {
        model: lane.model,
        endpoint: '/v1/chat/completions',
        provider: requests[0].body.provider,
        requests,
      });
      if (!response.ok) {
        this.ledger.release(id);
        throw new Error(`Batch submission status ${response.status}`);
      }
      const raw: unknown = await response.json();
      const data = batchSchema.parse(raw);
      if (typeof data.id !== 'string' || !/^batch_[A-Za-z0-9_-]+$/u.test(data.id))
        throw new Error('Unknown batch submission');
      this.ledger.pendingBatch(id, data.id);
      return { reservationId: id, batchId: data.id };
    } catch (error) {
      this.ledger.event('batch_submission_unknown');
      throw error;
    }
  }
  async pollBatch(reservationId: string): Promise<{ status: string; results?: unknown[] }> {
    const row = this.ledger.reservation(reservationId) as
      { batch_id: string | null; cost: number | null; reserved: number } | undefined;
    if (!row?.batch_id) throw new Error('Unknown batch reservation');
    const response = await this.request(`/batches/${encodeURIComponent(row.batch_id)}`);
    if (!response.ok) throw new Error(`Batch poll status ${response.status}`);
    const raw: unknown = await response.json();
    const data = batchSchema.parse(raw);
    if (data.status === 'completed') {
      const usage = parseUsage(raw);
      this.ledger.settle(reservationId, usage, { model: data.model, provider: data.provider });
      if (usage.cost > row.reserved) throw new Error('Actual batch cost exceeded reservation');
      return { status: 'completed', results: data.results };
    }
    if (['failed', 'expired', 'cancelled'].includes(data.status))
      this.ledger.event('batch_terminal_usage_unresolved');
    return { status: String(data.status) };
  }
}
