import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai/error';
import {
  COACH_TURN_JSON_SCHEMA,
  coachProviderTurnResultSchema as coachTurnResultSchema,
  type CoachTurnInput,
} from '../domain/coach';
import { serializeCoachInput } from '../domain/coachInputSerialization';
import { careerInstructionsForRole } from '../prompts/careerRolePrompts';
import { outputBudgetForRole } from './openAICoachProvider';
import {
  CoachProviderError,
  type CoachProvider,
  type CoachProviderResult,
  type CoachTurnOptions,
} from './coachProvider';
import { collectedCompletion, streamChatCompletion } from './chatCompletionStream';
import {
  PROVIDER_STAGE_MAX_RETRIES,
  PROVIDER_STAGE_TIMEOUT_MS,
} from './stageTimeout';
import { isMutableModelAlias } from './modelRegistry';
import { isFreeOpenRouterModel, openRouterRouting } from './openRouterPrivacy';

const OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
/**
 * Имя приложения в заголовке `X-Title`. Раньше здесь стояло «synthetic
 * evaluation»: до решения владельца 28.10 в OpenRouter уходили только
 * синтетические ходы (B082), теперь туда идут и персональные данные кандидатов.
 */
export const OPENROUTER_APP_TITLE = 'OpenQareer';

export interface OpenRouterCoachProviderOptions {
  apiKey: string;
  model?: string;
  /**
   * Схему вывода OpenRouter держит, и просить её честнее, чем вырезать JSON из
   * прозы: разбор `extractJsonPayload` оставался лишь на случай отказа модели.
   */
  structuredOutput?: boolean;
  /** `reasoning_effort` запроса; `high`, пока модель в реестре не названа иначе (B580). */
  reasoningEffort?: 'low' | 'high';
  timeoutMs?: number;
  client?: OpenAI;
}
export class OpenRouterCoachProvider implements CoachProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly structuredOutput: boolean;
  private readonly reasoningEffort: 'low' | 'high';
  private readonly timeoutMs: number;

  constructor(options: OpenRouterCoachProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS;
    this.model = options.model ?? OPENROUTER_MODEL;
    this.structuredOutput = options.structuredOutput ?? false;
    this.reasoningEffort = options.reasoningEffort ?? 'high';
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        timeout: this.timeoutMs,
        maxRetries: PROVIDER_STAGE_MAX_RETRIES,
        defaultHeaders: {
          'HTTP-Referer': 'https://openqareer.com',
          'X-Title': OPENROUTER_APP_TITLE,
        },
      });
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
    options?: CoachTurnOptions,
  ): Promise<CoachProviderResult> {
    const personal = input.dataClass !== 'synthetic';
    // Candidate data never reaches a free model or pool: their endpoints may train on it (28.10).
    if (personal && isFreeOpenRouterModel(this.model)) {
      throw new CoachProviderError('provider_unavailable', 503, false);
    }
    try {
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: careerInstructionsForRole(input.activeRole, input.internalPurpose),
          },
          {
            role: 'user',
            content: serializeCoachInput(input),
          },
        ],
        reasoning_effort: this.reasoningEffort,
        // Рассуждение тратит тот же бюджет, что и ответ: потолок в 2 400
        // обрезал ход на середине JSON, и наружу это выглядело как
        // `provider_output_invalid` (замер B185). Место под ответ считается той
        // же функцией, что и у OpenAI, — расходиться им незачем.
        max_completion_tokens: outputBudgetForRole(input.activeRole, 'high'),
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
        // `openrouter/free` — пул: без `require_parameters` он вправе увести вызов
        // к модели без схемы. Названной модели это условие ставить нельзя:
        // OpenRouter отвечает `404 No endpoints found` (живая проверка 2026-09-03).
        ...openRouterRouting({
          personal,
          requireParameters: this.structuredOutput && isMutableModelAlias(this.model),
        }),
      };
      // 29.10: a listener reads the reply as it is written; the result is the same either way.
      const onMessageText = options?.onMessageText;
      const response = onMessageText
        ? await streamChatCompletion(this.client, request, {
            idempotencyKey,
            timeoutMs: this.timeoutMs,
            onMessageText,
          })
        : collectedCompletion(await this.client.chat.completions.create(request, { idempotencyKey }));
      const content = response.content;
      if (!content) {
        throw new CoachProviderError(
          'provider_output_invalid',
          502,
          true,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonPayload(content));
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
        usage: usageOf(response.usage),
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
        if (error.status === 429) {
          throw new CoachProviderError(
            'provider_rate_limited',
            429,
            true,
          );
        }
        if (error.status === 402) {
          throw new CoachProviderError(
            'provider_budget_exhausted',
            502,
            false,
          );
        }
        if (error.status && error.status >= 500) {
          throw new CoachProviderError(
            'provider_unavailable',
            503,
            true,
          );
        }
      }
      throw new CoachProviderError('provider_unavailable', 503, true);
    }
  }
}

/** OpenRouter кладёт в `usage` ещё кэш и цену — поля вне типов OpenAI SDK. */
type OpenRouterUsage = OpenAI.Completions.CompletionUsage & { cost?: number };

function usageOf(usage: OpenRouterUsage | undefined) {
  const cached = usage?.prompt_tokens_details?.cached_tokens;
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    ...(typeof cached === 'number' ? { cachedInputTokens: cached } : {}),
    ...(typeof usage?.cost === 'number' ? { costUsd: usage.cost } : {}),
  };
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (match && match[1]) {
    return match[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
