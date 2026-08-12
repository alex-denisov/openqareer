import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai/error';
import {
  COACH_TURN_JSON_SCHEMA,
  coachTurnResultSchema,
  serializeCoachInput,
  type CoachTurnInput,
} from '../domain/coach';
import { careerInstructionsForRole } from '../prompts/careerRolePrompts';
import {
  CoachProviderError,
  type CoachProvider,
  type CoachProviderResult,
  type ProviderOutputDiagnostic,
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
          instructions: careerInstructionsForRole(input.activeRole),
          input: serializeCoachInput(input),
          reasoning: {
            effort: 'high',
            context: 'all_turns',
          },
          max_output_tokens: outputBudgetForRole(input.activeRole),
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

      if (response.status === 'incomplete') {
        throw invalidOutput(
          response.incomplete_details?.reason === 'max_output_tokens'
            ? 'response_incomplete_max_output_tokens'
            : 'response_incomplete_other',
          input.activeRole,
        );
      }
      if (hasRefusal(response.output)) {
        throw invalidOutput('response_refusal', input.activeRole);
      }
      if (!response.output_text) {
        throw invalidOutput('response_text_missing', input.activeRole);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.output_text);
      } catch {
        throw invalidOutput('response_json_invalid', input.activeRole);
      }

      const result = coachTurnResultSchema.safeParse(parsed);
      if (!result.success) {
        throw invalidOutput('response_schema_invalid', input.activeRole);
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

function outputBudgetForRole(role: CoachTurnInput['activeRole']): number {
  return role === 'career_strategist' ? 6_000 : 3_200;
}

function hasRefusal(
  output: OpenAI.Responses.ResponseOutputItem[] | undefined,
): boolean {
  return (output ?? []).some(
    (item) =>
      item.type === 'message' &&
      item.content.some((content) => content.type === 'refusal'),
  );
}

function invalidOutput(
  diagnostic: ProviderOutputDiagnostic,
  role: CoachTurnInput['activeRole'],
): CoachProviderError {
  return new CoachProviderError(
    'provider_output_invalid',
    502,
    true,
    diagnostic,
    role,
  );
}

function hashCandidateReference(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
