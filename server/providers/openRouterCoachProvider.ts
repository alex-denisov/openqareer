import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai/error';
import {
  coachTurnResultSchema,
  serializeCoachInput,
  type CoachTurnInput,
} from '../domain/coach';
import { careerInstructionsForRole } from '../prompts/careerRolePrompts';
import {
  CoachProviderError,
  type CoachProvider,
  type CoachProviderResult,
} from './coachProvider';

const OPENROUTER_MODEL =
  'nvidia/nemotron-3-ultra-550b-a55b:free';
const OPENROUTER_MODELS = [
  OPENROUTER_MODEL,
  'nvidia/nemotron-3-super-120b-a12b:free',
] as const;

export interface OpenRouterCoachProviderOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  client?: OpenAI;
}
export class OpenRouterCoachProvider implements CoachProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly models: readonly string[];

  constructor(options: OpenRouterCoachProviderOptions) {
    this.model = options.model ?? OPENROUTER_MODEL;
    this.models =
      this.model === OPENROUTER_MODEL ? OPENROUTER_MODELS : [this.model];
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        timeout: options.timeoutMs ?? 85_000,
        maxRetries: 1,
        defaultHeaders: {
          'HTTP-Referer': 'https://openqareer.com',
          'X-Title': 'OpenQareer synthetic evaluation',
        },
      });
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<CoachProviderResult> {
    if (input.dataClass !== 'synthetic') {
      throw new CoachProviderError(
        'provider_unavailable',
        503,
        false,
      );
    }

    try {
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
        models: readonly string[];
      } = {
        model: this.model,
        models: this.models,
        messages: [
          {
            role: 'system',
            content: careerInstructionsForRole(input.activeRole),
          },
          {
            role: 'user',
            content: serializeCoachInput(input),
          },
        ],
        reasoning_effort: 'high',
        max_completion_tokens: 2_400,
      };
      const response = await this.client.chat.completions.create(
        request,
        { idempotencyKey },
      );
      const content = response.choices[0]?.message.content;
      if (!content) {
        throw new CoachProviderError(
          'provider_output_invalid',
          502,
          true,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new CoachProviderError(
          'provider_output_invalid',
          502,
          true,
        );
      }
      const result = coachTurnResultSchema.safeParse(parsed);
      if (!result.success) {
        throw new CoachProviderError(
          'provider_output_invalid',
          502,
          true,
        );
      }

      return {
        result: result.data,
        provider: 'openrouter',
        model: response.model,
        responseId: response.id,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof CoachProviderError) {
        throw error;
      }
      if (error instanceof RateLimitError) {
        throw new CoachProviderError(
          'provider_rate_limited',
          429,
          true,
        );
      }
      if (error instanceof APIConnectionTimeoutError) {
        throw new CoachProviderError('provider_timeout', 504, true);
      }
      if (error instanceof APIConnectionError) {
        throw new CoachProviderError(
          'provider_unavailable',
          503,
          true,
        );
      }
      if (error instanceof APIError) {
        throw new CoachProviderError(
          'provider_unavailable',
          error.status && error.status >= 500 ? 503 : 502,
          error.status === 408 ||
            error.status === 409 ||
            error.status === 429,
        );
      }
      throw new CoachProviderError('provider_unavailable', 503, true);
    }
  }
}
