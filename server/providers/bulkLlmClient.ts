import { z } from 'zod';
import type { BulkLlmConfig, BulkOpenRouterLane } from './bulkLlmConfig';
import { MODEL_CHAINS } from './modelChains';
import type { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import type { BulkFallback } from './bulkGeminiFallback';
/** The ledger refused a reservation: a spend limit, not a provider or answer failure (B556). */
export const BULK_BUDGET_EXCEEDED = 'Bulk budget exceeded';

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
  /** Set when the answer came from a later stage: why the head was skipped (`vertex_429`). */
  fallbackReason?: string;
}
/** A switch of the channel to a later stage, for the worker journal and the owner alert. */
export interface BulkLlmChannelEvent {
  kind: 'fallback' | 'balance_exhausted';
  reason: string;
}
export interface BulkLlmClientOptions {
  /** Gemini on Vertex: its place in the chain is the `vertex` stage of `MODEL_CHAINS.bulk`. */
  vertex?: BulkFallback;
  now?: () => number;
  onEvent?: (event: BulkLlmChannelEvent) => void;
}
/** A stage that had an outage is probed again no more often than this (27.10 incident). */
export const PRIMARY_RETRY_AFTER_MS = 10 * 60_000;
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
const ACTUAL_COST_EXCEEDED = 'Actual cost exceeded reservation';
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

/** Vertex failures: an HTTP status from the reserve module, a transport error, or a bad answer. */
function vertexStageError(error: unknown): BulkStageError {
  const message = error instanceof Error ? error.message : 'vertex failure';
  const status = Number(/status (\d{3})/u.exec(message)?.[1]);
  if (Number.isFinite(status)) return new BulkStageError(`vertex_${status}`, isOutage(status), message);
  const transport =
    error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
  return transport
    ? new BulkStageError(transportReason('vertex', error), true, message)
    : new BulkStageError('vertex_invalid', false, message);
}

type BulkStage =
  | { readonly kind: 'openrouter'; readonly id: string; readonly lane: BulkOpenRouterLane }
  | { readonly kind: 'vertex'; readonly id: string; readonly vertex: BulkFallback };
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
    this.stages = MODEL_CHAINS.bulk.flatMap((stage): BulkStage[] => {
      if (stage.provider === 'vertex') {
        const vertex = options.vertex;
        return vertex ? [{ kind: 'vertex', id: 'vertex', vertex }] : [];
      }
      const lane = config.lanes.find((item) => item.model === stage.model);
      return lane ? [{ kind: 'openrouter', id: lane.model, lane }] : [];
    });
  }
  private readonly stages: readonly BulkStage[];
  private readonly down = new Map<string, { until: number; reason: string }>();
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  /** Stages of the chain in order, cooling ones left out; all of them when every one cools. */
  private openStages(): readonly BulkStage[] {
    const open = this.stages.filter((stage) => (this.down.get(stage.id)?.until ?? 0) <= this.now());
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
  private body(input: BulkLlmInput, lane: BulkOpenRouterLane) {
    const maxTokens = this.validate(input);
    const providers = lane.provider.split(',');
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
      reasoning: { enabled: false },
      usage: { include: true },
      provider: {
        // Список закреплённых провайдеров по порядку: цена или лимит одного не останавливают работу.
        order: providers,
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
        signal: AbortSignal.timeout(60000),
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
   * The bulk chain (`MODEL_CHAINS.bulk`, 28.10): Vertex → deepseek-v4.1-flash → glm-5.3-flash.
   * A failed or unusable answer moves the call to the next stage; an outage also cools the stage
   * for ten minutes. A spend cap or an uncertain charge stops the chain at once.
   */
  async complete(input: BulkLlmInput): Promise<BulkLlmResult> {
    this.validate(input);
    if (this.stages.length === 0) throw new Error('Bulk chain has no stages');
    const accept = input.accept ?? isJsonAnswer;
    const stages = this.openStages();
    let fallbackReason = stages[0] === this.stages[0] ? undefined : this.down.get(this.stages[0].id)?.reason;
    let lastError: unknown;
    for (const stage of stages) {
      try {
        const result = await this.completeStage(stage, input);
        this.down.delete(stage.id);
        if (!accept(result.content)) {
          this.ledger.event(`answer_rejected_${stage.kind}`);
          fallbackReason ??= `${stage.kind}_answer_rejected`;
          lastError = new Error(`Bulk answer rejected (${stage.id})`);
          continue;
        }
        return fallbackReason ? { ...result, fallbackReason } : result;
      } catch (error) {
        if (!(error instanceof BulkStageError)) throw error;
        lastError = error;
        fallbackReason ??= error.reason;
        this.ledger.event(`fallback_${error.reason}`);
        if (error.outage) this.cool(stage, error.reason);
      }
    }
    throw lastError;
  }
  private cool(stage: BulkStage, reason: string) {
    this.down.set(stage.id, { until: this.now() + PRIMARY_RETRY_AFTER_MS, reason });
    this.options.onEvent?.({ kind: 'fallback', reason });
    if (reason === 'openrouter_402') this.options.onEvent?.({ kind: 'balance_exhausted', reason });
  }
  private completeStage(stage: BulkStage, input: BulkLlmInput): Promise<BulkLlmResult> {
    return stage.kind === 'vertex'
      ? this.completeVertex(stage.vertex, input)
      : this.completeOpenRouter(stage.lane, input);
  }
  private async completeOpenRouter(
    lane: BulkOpenRouterLane,
    input: BulkLlmInput,
  ): Promise<BulkLlmResult> {
    const body = this.body(input, lane);
    const id = this.ledger.reserve({ ...input, model: lane.model, provider: lane.provider }, this.config);
    if (!id) throw new Error(BULK_BUDGET_EXCEEDED);
    let response: Response;
    try {
      response = await this.request('/chat/completions', body);
    } catch (error) {
      // No answer came back: nothing was billed, so the hold is freed at once.
      this.ledger.release(id);
      this.ledger.event('completion_failed_or_unknown');
      const reason = transportReason('openrouter', error);
      throw new BulkStageError(reason, true, error instanceof Error ? error.message : reason);
    }
    if (!response.ok) {
      this.ledger.release(id);
      await response.body?.cancel();
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
      const usage = parseUsage(result);
      const actual = z
        .object({ model: z.string().optional(), provider: z.string().optional() })
        .parse(result);
      this.ledger.settle(id, usage, actual);
      if (usage.cost > this.config.perRequestUsd) throw new BulkSpendError(ACTUAL_COST_EXCEEDED);
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
  private async completeVertex(vertex: BulkFallback, input: BulkLlmInput): Promise<BulkLlmResult> {
    const id = this.ledger.reserve(
      { ...input, model: vertex.model, provider: vertex.provider },
      this.config,
    );
    if (!id) throw new Error(BULK_BUDGET_EXCEEDED);
    let answer: Awaited<ReturnType<BulkFallback['complete']>>;
    try {
      answer = await vertex.complete({
        prefix: input.prefix,
        input: input.input,
        maxTokens: input.maxTokens ?? 2048,
      });
    } catch (error) {
      this.ledger.release(id);
      throw vertexStageError(error);
    }
    this.ledger.settle(id, answer.usage, { model: answer.model, provider: vertex.provider });
    return {
      content: answer.content,
      model: answer.model,
      provider: vertex.provider,
      usage: answer.usage,
    };
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
