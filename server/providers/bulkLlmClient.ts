import { z } from 'zod';
import type { BulkLlmConfig } from './bulkLlmConfig';
import type { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
export interface BulkLlmInput {
  runId: string;
  task: string;
  dataClass: 'public' | 'candidate';
  prefix: string;
  input: string;
  maxTokens?: number;
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
  ) {}
  private body(input: BulkLlmInput) {
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
    const inputUpperBound = Buffer.byteLength(input.prefix) + Buffer.byteLength(input.input) + 4096;
    const costUpperBound =
      (inputUpperBound * this.config.inputPerMillionUsd +
        maxTokens * this.config.outputPerMillionUsd) /
      1e6;
    if (inputUpperBound > 2_000_000 || costUpperBound > this.config.perRequestUsd)
      throw new Error('Request exceeds reserved budget');
    return {
      model: this.config.model,
      messages: [
        { role: 'system', content: input.prefix },
        { role: 'user', content: input.input },
      ],
      max_tokens: maxTokens,
      reasoning: { enabled: false },
      usage: { include: true },
      provider: {
        order: [this.config.provider],
        only: [this.config.provider],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: 'deny',
        quantizations: [this.config.quantization],
        max_price: {
          prompt: this.config.inputPerMillionUsd,
          completion: this.config.outputPerMillionUsd,
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
  async complete(input: BulkLlmInput): Promise<BulkLlmResult> {
    const body = this.body(input);
    const id = this.ledger.reserve(
      { ...input, model: this.config.model, provider: this.config.provider },
      this.config,
    );
    if (!id) throw new Error('Bulk budget exceeded');
    try {
      const response = await this.request('/chat/completions', body);
      if (!response.ok) {
        if ([400, 401, 403, 404, 422, 429].includes(response.status)) this.ledger.release(id);
        throw new Error(`Bulk provider status ${response.status}`);
      }
      const result: unknown = await response.json();
      const usage = parseUsage(result);
      const actual = z
        .object({ model: z.string().optional(), provider: z.string().optional() })
        .parse(result);
      this.ledger.settle(id, usage, actual);
      if (usage.cost > this.config.perRequestUsd)
        throw new Error('Actual cost exceeded reservation');
      const completion = completionSchema.parse(result);
      const content = completion.choices[0]?.message.content;
      if (typeof content !== 'string' || !content) throw new Error('Invalid bulk completion');
      if (completion.model !== this.config.model) throw new Error('Unexpected bulk model');
      return {
        content,
        model: completion.model,
        provider: completion.provider ?? this.config.provider,
        usage,
      };
    } catch (error) {
      this.ledger.event('completion_failed_or_unknown');
      throw error;
    }
  }
  async submitBatch(inputs: BulkLlmInput[]): Promise<{ reservationId: string; batchId: string }> {
    if (!this.config.batchEnabled) throw new Error('Batch endpoint eligibility not enabled');
    if (
      inputs.length < 1 ||
      inputs.length > 100 ||
      inputs.some((i) => i.dataClass !== 'public' || i.runId !== inputs[0].runId)
    )
      throw new Error('Batch requires public inputs from one run');
    const requests = inputs.map((input, index) => ({
      custom_id: String(index),
      body: this.body(input),
    }));
    const id = this.ledger.reserve(
      { ...inputs[0], model: this.config.model, provider: this.config.provider },
      this.config,
      inputs.length * this.config.perRequestUsd,
    );
    if (!id) throw new Error('Bulk budget exceeded');
    try {
      const response = await this.request('/batches', {
        model: this.config.model,
        endpoint: '/v1/chat/completions',
        provider: requests[0].body.provider,
        requests,
      });
      if (!response.ok) {
        if ([400, 401, 403, 404, 422, 429].includes(response.status)) this.ledger.release(id);
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
