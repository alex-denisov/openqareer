import OpenAI from 'openai';
import {
  EXPERIENCE_FACT_REWRITE_INSTRUCTIONS,
  EXPERIENCE_FACT_REWRITE_JSON_SCHEMA,
  EXPERIENCE_FACT_REWRITE_PROMPT_REVISION,
  factRewriteModelOutputSchema,
  factRewriteUserMessage,
  type FactRewriteModelOutput,
  type FactRewriteRequest,
} from '../domain/experienceFactRewrite';
import { chainRoutes, MODEL_CHAINS } from './modelChains';
import { modelRegistry, type ProviderId } from './modelRegistry';
import {
  assertOpenRouterModelForPersonalData,
  isOpenRouterBaseUrl,
  openRouterRouting,
} from './openRouterPrivacy';
import type { ChatCompletionClient } from './resumeStructurer';

/** One stage may take this long: the candidate waits for the block while it works. */
export const FACT_REWRITE_STAGE_TIMEOUT_MS = 90_000;

export interface ExperienceFactRewriter {
  /** Returns `null` when no stage produced a valid answer. */
  rewrite(request: FactRewriteRequest): Promise<FactRewriteModelOutput | null>;
  readonly provenance?: Readonly<{ model: string; promptRevision: string }>;
}

export interface LlmFactRewriterOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly structuredOutput?: boolean;
  readonly client?: ChatCompletionClient;
}

/** Facts in, bullets per workplace out, as validated JSON. */
export class LlmExperienceFactRewriter implements ExperienceFactRewriter {
  private readonly client: ChatCompletionClient;
  private readonly openRouter: boolean;
  private readonly structuredOutput: boolean;
  readonly provenance: Readonly<{ model: string; promptRevision: string }>;

  constructor(private readonly options: LlmFactRewriterOptions) {
    this.provenance = {
      model: options.model,
      promptRevision: EXPERIENCE_FACT_REWRITE_PROMPT_REVISION,
    };
    this.structuredOutput = options.structuredOutput ?? true;
    // What the candidate said about their work is personal data (28.10).
    this.openRouter = isOpenRouterBaseUrl(options.baseUrl);
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        timeout: options.timeoutMs ?? FACT_REWRITE_STAGE_TIMEOUT_MS,
        maxRetries: 0,
      }) as unknown as ChatCompletionClient);
  }

  async rewrite(request: FactRewriteRequest): Promise<FactRewriteModelOutput | null> {
    if (request.facts.length === 0 || request.places.length === 0) return null;
    if (this.openRouter) assertOpenRouterModelForPersonalData(this.options.model);
    const response = await this.client.chat.completions.create({
      model: this.options.model,
      messages: [
        { role: 'system', content: EXPERIENCE_FACT_REWRITE_INSTRUCTIONS },
        { role: 'user', content: factRewriteUserMessage(request) },
      ],
      // Reasoning and the answer share this cap: 65 facts need room for both.
      max_completion_tokens: 16_000,
      ...(this.structuredOutput
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: 'experience_fact_rewrite',
                strict: true,
                schema: EXPERIENCE_FACT_REWRITE_JSON_SCHEMA as unknown as Record<string, unknown>,
              },
            },
          }
        : { response_format: { type: 'json_object' as const } }),
      ...openRouterRouting({ personal: this.openRouter }),
      // Thinking and the answer share the cap: a capped thought leaves room for the
      // answer (glm 29.10: 4 535 of 6 000 thinking, then 12 bullets).
      ...(this.openRouter ? { reasoning: { max_tokens: 6_000 } } : {}),
    });
    return readModelOutput(response.choices[0]?.message.content ?? '');
  }
}

export function readModelOutput(content: string): FactRewriteModelOutput | null {
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    const parsed = factRewriteModelOutputSchema.safeParse(
      JSON.parse(content.slice(first, last + 1)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Stages in order: a failure or an invalid answer moves on to the next one. */
export class QueuedExperienceFactRewriter implements ExperienceFactRewriter {
  private answered: ExperienceFactRewriter | undefined;

  constructor(
    readonly stages: readonly ExperienceFactRewriter[],
    private readonly onStageFailure: (model: string, error: unknown) => void = () => undefined,
  ) {}

  get provenance(): ExperienceFactRewriter['provenance'] {
    return (this.answered ?? this.stages[0])?.provenance;
  }

  async rewrite(request: FactRewriteRequest): Promise<FactRewriteModelOutput | null> {
    for (const stage of this.stages) {
      try {
        const output = await stage.rewrite(request);
        // An answer that drops every fact is a failed stage, not a verdict (deepseek, 29.10).
        if (output && output.places.some((place) => place.bullets.length > 0)) {
          this.answered = stage;
          return output;
        }
        this.onStageFailure(stage.provenance?.model ?? 'unknown', new Error('invalid_answer'));
      } catch (error) {
        this.onStageFailure(stage.provenance?.model ?? 'unknown', error);
      }
    }
    return null;
  }
}

export function buildExperienceFactRewriter(config: {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  readonly onStageFailure?: (model: string, error: unknown) => void;
}): ExperienceFactRewriter | undefined {
  const routes = chainRoutes(MODEL_CHAINS.experienceBullets, config.providerCredentials ?? {});
  if (routes.length === 0) return undefined;
  return new QueuedExperienceFactRewriter(
    routes.map(
      (route) =>
        new LlmExperienceFactRewriter({
          apiKey: route.apiKey,
          model: route.model,
          baseUrl: route.provider === 'openai' ? undefined : modelRegistry[route.provider].baseUrl,
          structuredOutput:
            modelRegistry[route.provider].models.find((item) => item.id === route.model)
              ?.structuredOutput ?? true,
        }),
    ),
    config.onStageFailure,
  );
}
