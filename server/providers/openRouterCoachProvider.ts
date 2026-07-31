import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai/error';
import {
  CAREER_COACH_INSTRUCTIONS,
  COACH_TURN_JSON_SCHEMA,
  coachTurnResultSchema,
  serializeCoachInput,
  type CoachTurnInput,
} from '../domain/coach';
import {
  CoachProviderError,
  type CoachProvider,
  type CoachProviderResult,
} from './coachProvider';

const OPENROUTER_MODEL =
  'nvidia/nemotron-3-ultra-550b-a55b:free';

export interface OpenRouterCoachProviderOptions {
  apiKey: string;
  timeoutMs?: number;
  client?: OpenAI;
}
export class OpenRouterCoachProvider implements CoachProvider {
  private readonly client: OpenAI;

  constructor(options: OpenRouterCoachProviderOptions) {
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
      const response = await this.client.chat.completions.create(
        {
          model: OPENROUTER_MODEL,
          messages: [
            {
              role: 'system',
              content: CAREER_COACH_INSTRUCTIONS,
            },
            {
              role: 'user',
              content: serializeCoachInput(input),
            },
          ],
          reasoning_effort: 'high',
          max_completion_tokens: 2_400,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'career_coach_turn',
              strict: true,
              schema: COACH_TURN_JSON_SCHEMA,
            },
          },
        },
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
