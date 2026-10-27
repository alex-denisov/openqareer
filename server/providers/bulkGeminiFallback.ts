import { z } from 'zod';
import {
  retryOn429,
  VertexTokenProvider,
  vertexPublisherBaseUrl,
  type VertexConfig,
} from './vertexAi';

/**
 * Reserve lane of the bulk channel (27.10: OpenRouter ran out of balance, every call got 402 and no
 * match percent was computed for 9 hours). Gemini on Vertex under the service account, the same
 * module every other Gemini stage uses; the answer goes back through the caller's own JSON schema.
 */
export const BULK_FALLBACK_PROVIDER = 'gemini';
/** Vertex list price of the flash tier per million tokens: an upper bound for the ledger. */
const DEFAULT_INPUT_PER_MILLION_USD = 0.5;
const DEFAULT_OUTPUT_PER_MILLION_USD = 3;
const REQUEST_TIMEOUT_MS = 60_000;
const RETRIES_ON_429 = 2;

export interface BulkFallbackRequest {
  prefix: string;
  input: string;
  maxTokens: number;
}
export interface BulkFallbackAnswer {
  content: string;
  model: string;
  usage: { cost: number; promptTokens: number; cachedTokens: number; completionTokens: number };
}
export interface BulkFallback {
  readonly provider: string;
  readonly model: string;
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  complete(request: BulkFallbackRequest): Promise<BulkFallbackAnswer>;
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

export class VertexBulkFallback implements BulkFallback {
  readonly provider = BULK_FALLBACK_PROVIDER;
  readonly model: string;
  private readonly tokens: VertexTokenProvider;

  constructor(
    private readonly config: VertexConfig,
    readonly inputPerMillionUsd = DEFAULT_INPUT_PER_MILLION_USD,
    readonly outputPerMillionUsd = DEFAULT_OUTPUT_PER_MILLION_USD,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.model = config.model;
    this.tokens = new VertexTokenProvider(config, fetchImpl);
  }

  async complete(request: BulkFallbackRequest): Promise<BulkFallbackAnswer> {
    const token = await this.tokens.token();
    const url = `${vertexPublisherBaseUrl(this.config)}/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await retryOn429(
      () =>
        this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.prefix }] },
            contents: [{ role: 'user', parts: [{ text: request.input }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: request.maxTokens,
              thinkingConfig: { thinkingLevel: 'low' },
            },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      RETRIES_ON_429,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Bulk fallback status ${response.status}`);
    }
    const body = answerSchema.parse(await response.json());
    const model = body.modelVersion ?? this.model;
    // Vertex may answer with a dated revision of the pinned model, never with another model.
    if (!model.startsWith(this.model)) throw new Error('Unexpected bulk fallback model');
    const content = body.candidates[0].content.parts.map((part) => part.text ?? '').join('');
    if (!content) throw new Error('Invalid bulk fallback completion');
    const usage = body.usageMetadata;
    const completionTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    return {
      content,
      model,
      usage: {
        cost:
          (usage.promptTokenCount * this.inputPerMillionUsd +
            completionTokens * this.outputPerMillionUsd) /
          1e6,
        promptTokens: usage.promptTokenCount,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
        completionTokens,
      },
    };
  }
}
