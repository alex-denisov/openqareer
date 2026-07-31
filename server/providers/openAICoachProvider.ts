import { createHash } from 'node:crypto';
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

export interface OpenAICoachProviderOptions {
  apiKey: string;
  model: 'gpt-5.6' | 'gpt-5.6-sol';
  timeoutMs?: number;
  client?: OpenAI;
}

export class OpenAICoachProvider implements CoachProvider {
  private readonly client: OpenAI;
  private readonly model: OpenAICoachProviderOptions['model'];

  constructor(options: OpenAICoachProviderOptions) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? 75_000,
        maxRetries: 1,
      });
    this.model = options.model;
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<CoachProviderResult> {
    try {
      const response = await this.client.responses.create(
        {
          model: this.model,
          store: false,
          instructions: CAREER_COACH_INSTRUCTIONS,
          input: serializeCoachInput(input),
          reasoning: {
            effort: 'high',
            context: 'all_turns',
          },
          max_output_tokens: 2_400,
          safety_identifier: hashCandidateReference(input.candidateReference),
          text: {
            format: {
              type: 'json_schema',
              name: 'career_coach_turn',
              strict: true,
              schema: COACH_TURN_JSON_SCHEMA,
            },
          },
        },
        { idempotencyKey },
      );

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.output_text);
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
        provider: 'openai',
        model: response.model,
        responseId: response.id,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof CoachProviderError) {
        throw error;
      }
      if (error instanceof RateLimitError) {
        if (error.code === 'credit_balance_exhausted') {
          throw new CoachProviderError(
            'provider_budget_exhausted',
            503,
            false,
          );
        }
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
          error.status === 408 || error.status === 409 || error.status === 429,
        );
      }
      throw new CoachProviderError('provider_unavailable', 503, true);
    }
  }
}

function hashCandidateReference(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
