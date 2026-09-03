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
import {
  PROVIDER_STAGE_MAX_RETRIES,
  PROVIDER_STAGE_TIMEOUT_MS,
} from './stageTimeout';

/** Модели OpenAI, которые реестр разрешает персональному маршруту (B183). */
export type OpenAICoachModel = 'gpt-5.6' | 'gpt-5.6-sol' | 'gpt-5.6-luna';

export interface OpenAICoachProviderOptions {
  apiKey: string;
  model: OpenAICoachModel;
  timeoutMs?: number;
  client?: OpenAI;
}

/**
 * Выбор владельца: 2026-09-02 — `xhigh`, 2026-09-03 уточнено до `high`
 * (B183). Усилие едет вместе с местом под него — см. `outputBudgetForRole`.
 */
const COACH_REASONING_EFFORT = 'high' as const;

export class OpenAICoachProvider implements CoachProvider {
  private readonly client: OpenAI;
  private readonly model: OpenAICoachProviderOptions['model'];

  constructor(options: OpenAICoachProviderOptions) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS,
        maxRetries: PROVIDER_STAGE_MAX_RETRIES,
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
            effort: COACH_REASONING_EFFORT,
            context: 'all_turns',
          },
          max_output_tokens: outputBudgetForRole(
            input.activeRole,
            COACH_REASONING_EFFORT,
          ),
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

/**
 * Рассуждение тратит **тот же** бюджет вывода, что и ответ.
 *
 * На проде ход коуча падал `response_incomplete_max_output_tokens`: усилие
 * подняли до `xhigh`, а потолок оставили прежним, и модель израсходовала его на
 * размышление, не дойдя до ответа (B183). Тот же дефект вскрылся у Gemini —
 * см. `geminiOutputBudget`. Усилие рассуждения обязано ехать вместе с местом
 * под него.
 */
export function outputBudgetForRole(
  role: CoachTurnInput['activeRole'],
  effort: OpenAI.Reasoning['effort'] = 'medium',
): number {
  const answer = role === 'career_strategist' ? 6_000 : 3_200;
  const reasoningHeadroom =
    effort === 'xhigh' || effort === 'max'
      ? 12_000
      : effort === 'high'
        ? 6_000
        : 0;
  return answer + reasoningHeadroom;
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
