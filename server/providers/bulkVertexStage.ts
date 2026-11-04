import { z } from 'zod';
import type { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import type { BulkLlmInput, BulkLlmResult } from './bulkLlmClient';
import { createMeteredVertexFetch, vertexBookingId } from './meteredVertexFetch';
import { vertexPublisherBaseUrl, type VertexConfig } from './vertexAi';
import { VertexSkippedError, type VertexGate } from './vertexCredit';
import { vertexCallCostUsd, vertexOutputTokens } from './vertexPricing';

/**
 * Vertex Gemini as the first stage of the bulk chain (owner 04.11, while the welcome credit lasts).
 * It is outside OpenRouter's money: no reservation, no per-request, run, day or month bound of the
 * channel and no latch; its only limits are the credit gate's. Any failure here, an unusable answer
 * included, is silent for the caller: the chain goes on with OpenRouter.
 */
const SAMPLING_SEED = 20261102;
/** Thinking and the answer share one output cap (memory: reasoning effort needs output budget). */
const THINKING_HEADROOM_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * Vertex has no per-request bound of the channel, so the input is bounded here: 500 KB is about
 * $0.1 a call at the catalog price. The longest percent inputs on prod are ~195 KB; anything larger
 * goes to OpenRouter and its reserved-budget bound.
 */
export const VERTEX_MAX_INPUT_BYTES = 500_000;

export interface BulkVertexStageOptions {
  readonly config: VertexConfig;
  readonly gate: VertexGate;
  readonly ledger: Pick<SqliteBulkLlmLedger, 'markGeminiFailure' | 'event'>;
  readonly token: () => Promise<string>;
  readonly transport: typeof fetch;
}

const answerSchema = z.object({
  modelVersion: z.string().optional(),
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }),
      }),
    )
    .min(1),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative(),
    candidatesTokenCount: z.number().int().nonnegative().optional(),
    thoughtsTokenCount: z.number().int().nonnegative().optional(),
    cachedContentTokenCount: z.number().int().nonnegative().optional(),
  }),
});

function failureReason(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    return 'vertex_timeout';
  return 'vertex_network';
}

export class BulkVertexStage {
  constructor(private readonly options: BulkVertexStageOptions) {}

  /** `result` on a usable answer; otherwise `failure` names why (undefined: skipped by the gate). */
  async ask(
    input: BulkLlmInput,
    maxTokens: number,
    accept: (content: string) => boolean,
  ): Promise<{ result?: BulkLlmResult; failure?: string }> {
    const { gate } = this.options;
    if (Buffer.byteLength(input.prefix) + Buffer.byteLength(input.input) > VERTEX_MAX_INPUT_BYTES)
      return { failure: 'vertex_input_too_large' };
    try {
      gate.admit(input.task);
    } catch (error) {
      if (error instanceof VertexSkippedError) return {};
      return { failure: 'vertex_gate' };
    }
    let token: string;
    try {
      token = await this.options.token();
    } catch (error) {
      // No token, no call: cool Vertex so that every job does not repeat the failing request.
      gate.failed({ text: `token: ${error instanceof Error ? error.message : 'unknown'}` });
      return { failure: 'vertex_token' };
    }
    let response: Response;
    try {
      response = await this.send(input, maxTokens, token);
    } catch (error) {
      return error instanceof VertexSkippedError ? {} : { failure: failureReason(error) };
    }
    if (!response.ok) return { failure: `vertex_${response.status}` };
    return this.read(response, accept);
  }

  private send(input: BulkLlmInput, maxTokens: number, token: string): Promise<Response> {
    const { config, gate } = this.options;
    const metered = createMeteredVertexFetch({
      gate,
      task: input.task,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetchImpl: this.options.transport,
      preAdmitted: true,
    });
    return metered(
      `${vertexPublisherBaseUrl(config)}/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.prefix }] },
          contents: [{ role: 'user', parts: [{ text: input.input }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0,
            maxOutputTokens: maxTokens + THINKING_HEADROOM_TOKENS,
            thinkingConfig: { thinkingLevel: 'low' },
            seed: SAMPLING_SEED,
          },
        }),
      },
    );
  }

  private async read(
    response: Response,
    accept: (content: string) => boolean,
  ): Promise<{ result?: BulkLlmResult; failure?: string }> {
    const id = vertexBookingId(response);
    const mark = (failure: string) => {
      if (!id) return;
      try {
        this.options.ledger.markGeminiFailure(id, failure);
      } catch {
        // The row is already booked with its cost; the reason is a nicety.
      }
    };
    const parsed = answerSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      mark('invalid_response');
      return { failure: 'vertex_invalid' };
    }
    const body = parsed.data;
    const model = body.modelVersion ?? this.options.config.model;
    // Vertex may answer with a dated revision of the pinned model, never with another model.
    const content = body.candidates[0]?.content.parts.map((part) => part.text ?? '').join('') ?? '';
    if (!model.startsWith(this.options.config.model) || !content) {
      mark('invalid_response');
      return { failure: 'vertex_invalid' };
    }
    const usage = body.usageMetadata;
    const result: BulkLlmResult = {
      content,
      model,
      provider: 'vertex',
      usage: {
        cost: vertexCallCostUsd(usage),
        promptTokens: usage.promptTokenCount,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
        completionTokens: vertexOutputTokens(usage),
      },
    };
    if (!accept(content)) {
      // The money is spent: the row stays `settled` at its real cost and says why it was useless.
      mark('answer_rejected');
      this.options.ledger.event('answer_rejected_vertex');
      return { failure: 'vertex_answer_rejected' };
    }
    return { result };
  }
}
