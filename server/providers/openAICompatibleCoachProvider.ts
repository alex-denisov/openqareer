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
} from './coachProvider';
import type { ProviderId } from './modelRegistry';
import {
  PROVIDER_STAGE_MAX_RETRIES,
  PROVIDER_STAGE_TIMEOUT_MS,
} from './stageTimeout';

export type OpenAICompatibleProviderId =
  | 'fireworks'
  | 'groq'
  | 'mistral'
  | 'cerebras'
  | 'kilocode'
  | 'nvidia'
  | 'opencode_zen'
  | 'tokenrouter'
  | 'sambanova'
  | 'pollinations'
  | 'huggingface';

export interface OpenAICompatibleCoachProviderOptions {
  provider: OpenAICompatibleProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  structuredOutput: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  client?: OpenAI;
}

export class OpenAICompatibleCoachProvider implements CoachProvider {
  private readonly client: OpenAI;
  private readonly provider: OpenAICompatibleProviderId;
  private readonly model: string;
  private readonly structuredOutput: boolean;
  private readonly reasoningEffort?: 'low' | 'medium' | 'high';

  constructor(options: OpenAICompatibleCoachProviderOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.structuredOutput = options.structuredOutput;
    this.reasoningEffort = options.reasoningEffort;
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        timeout: options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS,
        maxRetries: PROVIDER_STAGE_MAX_RETRIES,
      });
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<CoachProviderResult> {
    try {
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: this.model,
        messages: [
          { role: 'system', content: careerInstructionsForRole(input.activeRole) },
          { role: 'user', content: serializeCoachInput(input) },
        ],
        max_completion_tokens: 2_400,
        ...(this.reasoningEffort
          ? { reasoning_effort: this.reasoningEffort }
          : {}),
        ...(this.structuredOutput
          ? {
              response_format: {
                type: 'json_schema' as const,
                json_schema: {
                  name: 'career_coach_turn',
                  strict: true,
                  schema: COACH_TURN_JSON_SCHEMA,
                },
              },
            }
          : {}),
      };
      const response = await this.client.chat.completions.create(request, {
        idempotencyKey,
      });
      const content = response.choices[0]?.message.content;
      if (!content) {
        throw invalidOutput();
      }
      const result = parseCoachResult(content);
      return {
        result,
        provider: this.provider,
        model: response.model,
        responseId: response.id,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      throw mapProviderError(error);
    }
  }
}

function parseCoachResult(content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw invalidOutput();
  }
  const result = coachTurnResultSchema.safeParse(parsed);
  if (!result.success) {
    throw invalidOutput();
  }
  return result.data;
}

function invalidOutput(): CoachProviderError {
  return new CoachProviderError('provider_output_invalid', 502, true);
}

function mapProviderError(error: unknown): CoachProviderError {
  if (error instanceof CoachProviderError) return error;
  if (error instanceof RateLimitError) {
    return new CoachProviderError('provider_rate_limited', 429, true);
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new CoachProviderError('provider_timeout', 504, true);
  }
  if (error instanceof APIConnectionError) {
    return new CoachProviderError('provider_unavailable', 503, true);
  }
  if (error instanceof APIError) {
    return new CoachProviderError(
      'provider_unavailable',
      error.status && error.status >= 500 ? 503 : 502,
      error.status === 408 || error.status === 409 || error.status === 429,
    );
  }
  return new CoachProviderError('provider_unavailable', 503, true);
}

export function isOpenAICompatibleProvider(
  provider: ProviderId,
): provider is OpenAICompatibleProviderId {
  return [
    'fireworks',
    'groq',
    'mistral',
    'cerebras',
    'kilocode',
    'nvidia',
    'opencode_zen',
    'tokenrouter',
    'sambanova',
    'pollinations',
    'huggingface',
  ].includes(provider);
}
