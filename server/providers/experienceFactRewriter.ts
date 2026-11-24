import OpenAI from 'openai';
import type { z } from 'zod';
import {
  BULLET_TRANSLATION_INSTRUCTIONS,
  BULLET_TRANSLATION_JSON_SCHEMA,
  bulletTranslationOutputSchema,
  bulletTranslationUserMessage,
  type BulletTranslationOutput,
  type BulletTranslationRequest,
} from '../domain/experienceBulletLanguage';
import {
  EXPERIENCE_FACT_REWRITE_INSTRUCTIONS,
  EXPERIENCE_FACT_REWRITE_JSON_SCHEMA,
  EXPERIENCE_FACT_REWRITE_PROMPT_REVISION,
  factRewriteModelOutputSchema,
  factRewriteUserMessage,
  type FactRewriteModelOutput,
  type FactRewriteRequest,
} from '../domain/experienceFactRewrite';
import {
  linkedinRewriteOutputSchema,
  type LinkedinRewriteOutput,
  type LinkedinRewriteRequest,
} from '../linkedinProfile/linkedinRewrite';
import {
  LINKEDIN_REWRITE_INSTRUCTIONS,
  LINKEDIN_REWRITE_JSON_SCHEMA,
  linkedinRewriteUserMessage,
} from '../linkedinProfile/linkedinRewritePrompt';
import {
  linkedinVariantOutputSchema,
  type LinkedinVariantOutput,
  type LinkedinVariantRequest,
} from '../linkedinProfile/linkedinVariant';
import {
  LINKEDIN_VARIANT_INSTRUCTIONS,
  LINKEDIN_VARIANT_JSON_SCHEMA,
  linkedinVariantUserMessage,
} from '../linkedinProfile/linkedinVariantPrompt';
import {
  hhResumeVariantOutputSchema,
  type HhResumeVariantOutput,
  type HhResumeVariantRequest,
} from '../domain/hhResumeVariant';
import {
  HH_RESUME_VARIANT_INSTRUCTIONS,
  HH_RESUME_VARIANT_JSON_SCHEMA,
  hhResumeVariantUserMessage,
} from '../domain/hhResumeVariantPrompt';
import {
  checkFactRewriteVariant,
  FACT_REWRITE_VARIANT_INSTRUCTIONS,
  FACT_REWRITE_VARIANT_JSON_SCHEMA,
  factRewriteVariantOutputSchema,
  factRewriteVariantUserMessage,
  type FactRewriteVariantOutput,
  type FactRewriteVariantRequest,
} from '../domain/factRewriteVariant';
import { MODEL_CHAINS, resolveChain } from './modelChains';
import type { VertexConfig } from './vertexAi';
import { VertexJsonClient } from './vertexJson';
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
  /** Translates waiting bullets into their profile's language; `null` when no stage could. */
  translate?(request: BulletTranslationRequest): Promise<BulletTranslationOutput | null>;
  /** B645: «О себе» и «Опыт» для LinkedIn пересказом подтверждённых фактов; `null` — ни одна ступень не смогла. */
  linkedinProfile?(request: LinkedinRewriteRequest): Promise<LinkedinRewriteOutput | null>;
  linkedinVariant?(request: LinkedinVariantRequest): Promise<LinkedinVariantOutput | null>;
  /** B682: «Другой вариант» правки резюме hh.ru. */
  hhResumeVariant?(request: HhResumeVariantRequest): Promise<HhResumeVariantOutput | null>;
  /** B786: «Другой вариант» пункта резюме (k06). */
  rewriteVariant?(request: FactRewriteVariantRequest): Promise<FactRewriteVariantOutput | null>;
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
    const content = await this.complete(
      EXPERIENCE_FACT_REWRITE_INSTRUCTIONS,
      factRewriteUserMessage(request),
      'experience_fact_rewrite',
      EXPERIENCE_FACT_REWRITE_JSON_SCHEMA,
    );
    return readModelOutput(content);
  }

  async translate(request: BulletTranslationRequest): Promise<BulletTranslationOutput | null> {
    if (request.bullets.length === 0) return null;
    const content = await this.complete(
      BULLET_TRANSLATION_INSTRUCTIONS,
      bulletTranslationUserMessage(request),
      'experience_bullet_translation',
      BULLET_TRANSLATION_JSON_SCHEMA,
    );
    return readJsonAnswer(content, bulletTranslationOutputSchema);
  }

  async linkedinProfile(request: LinkedinRewriteRequest): Promise<LinkedinRewriteOutput | null> {
    if (request.aboutFacts.length === 0 && request.places.length === 0) return null;
    const content = await this.complete(
      LINKEDIN_REWRITE_INSTRUCTIONS,
      linkedinRewriteUserMessage(request),
      'linkedin_profile_rewrite',
      LINKEDIN_REWRITE_JSON_SCHEMA,
    );
    return readJsonAnswer(content, linkedinRewriteOutputSchema);
  }

  async linkedinVariant(request: LinkedinVariantRequest): Promise<LinkedinVariantOutput | null> {
    if (request.facts.length === 0) return null;
    const content = await this.complete(
      LINKEDIN_VARIANT_INSTRUCTIONS,
      linkedinVariantUserMessage(request),
      'linkedin_profile_variant',
      LINKEDIN_VARIANT_JSON_SCHEMA,
    );
    return readJsonAnswer(content, linkedinVariantOutputSchema);
  }

  async hhResumeVariant(request: HhResumeVariantRequest): Promise<HhResumeVariantOutput | null> {
    if (request.facts.length === 0) return null;
    const content = await this.complete(
      HH_RESUME_VARIANT_INSTRUCTIONS,
      hhResumeVariantUserMessage(request),
      'hh_resume_variant',
      HH_RESUME_VARIANT_JSON_SCHEMA,
    );
    return readJsonAnswer(content, hhResumeVariantOutputSchema);
  }

  async rewriteVariant(request: FactRewriteVariantRequest): Promise<FactRewriteVariantOutput | null> {
    if (request.facts.length === 0) return null;
    const content = await this.complete(
      FACT_REWRITE_VARIANT_INSTRUCTIONS,
      factRewriteVariantUserMessage(request),
      'experience_fact_rewrite_variant',
      FACT_REWRITE_VARIANT_JSON_SCHEMA,
    );
    return readJsonAnswer(content, factRewriteVariantOutputSchema);
  }

  private async complete(
    system: string,
    user: string,
    name: string,
    schema: object,
  ): Promise<string> {
    if (this.openRouter) assertOpenRouterModelForPersonalData(this.options.model);
    const response = await this.client.chat.completions.create({
      model: this.options.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Reasoning and the answer share this cap: 65 facts need room for both.
      max_completion_tokens: 16_000,
      ...(this.structuredOutput
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name,
                strict: true,
                schema: schema as unknown as Record<string, unknown>,
              },
            },
          }
        : { response_format: { type: 'json_object' as const } }),
      ...openRouterRouting({ personal: this.openRouter }),
      // Thinking and the answer share the cap: a capped thought leaves room for the
      // answer (glm 29.10: 4 535 of 6 000 thinking, then 12 bullets).
      ...(this.openRouter ? { reasoning: { max_tokens: 6_000 } } : {}),
    });
    return response.choices[0]?.message.content ?? '';
  }
}

export function readModelOutput(content: string): FactRewriteModelOutput | null {
  return readJsonAnswer(content, factRewriteModelOutputSchema);
}

function readJsonAnswer<T>(content: string, schema: z.ZodType<T>): T | null {
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(content.slice(first, last + 1)));
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

  async translate(request: BulletTranslationRequest): Promise<BulletTranslationOutput | null> {
    for (const stage of this.stages) {
      if (!stage.translate) continue;
      try {
        const output = await stage.translate(request);
        if (output && output.bullets.length > 0) return output;
        this.onStageFailure(stage.provenance?.model ?? 'unknown', new Error('invalid_answer'));
      } catch (error) {
        this.onStageFailure(stage.provenance?.model ?? 'unknown', error);
      }
    }
    return null;
  }

  linkedinProfile(request: LinkedinRewriteRequest): Promise<LinkedinRewriteOutput | null> {
    return firstLinkedinAnswer(this.stages, request, this.onStageFailure);
  }

  async linkedinVariant(request: LinkedinVariantRequest): Promise<LinkedinVariantOutput | null> {
    for (const stage of this.stages) {
      if (!stage.linkedinVariant) continue;
      try {
        const output = await stage.linkedinVariant(request);
        if (output?.text.trim()) return output;
        this.onStageFailure(stage.provenance?.model ?? 'unknown', new Error('invalid_answer'));
      } catch (error) {
        this.onStageFailure(stage.provenance?.model ?? 'unknown', error);
      }
    }
    return null;
  }

  async hhResumeVariant(request: HhResumeVariantRequest): Promise<HhResumeVariantOutput | null> {
    for (const stage of this.stages) {
      if (!stage.hhResumeVariant) continue;
      try {
        const output = await stage.hhResumeVariant(request);
        if (output?.text.trim()) return output;
        this.onStageFailure(stage.provenance?.model ?? 'unknown', new Error('invalid_answer'));
      } catch (error) {
        this.onStageFailure(stage.provenance?.model ?? 'unknown', error);
      }
    }
    return null;
  }

  async rewriteVariant(request: FactRewriteVariantRequest): Promise<FactRewriteVariantOutput | null> {
    for (const stage of this.stages) {
      if (!stage.rewriteVariant) continue;
      try {
        const output = await stage.rewriteVariant(request);
        // Не прошедший проверку ответ — неудача ступени: вариант пишет следующая модель.
        if (output && checkFactRewriteVariant(request, output)) return output;
        this.onStageFailure(stage.provenance?.model ?? 'unknown', new Error('invalid_answer'));
      } catch (error) {
        this.onStageFailure(stage.provenance?.model ?? 'unknown', error);
      }
    }
    return null;
  }
}

/** Ступени по очереди: ответ без «О себе» и без мест — неудача ступени. */
async function firstLinkedinAnswer(
  stages: readonly ExperienceFactRewriter[],
  request: LinkedinRewriteRequest,
  onStageFailure: (model: string, error: unknown) => void,
): Promise<LinkedinRewriteOutput | null> {
  for (const stage of stages) {
    if (!stage.linkedinProfile) continue;
    try {
      const output = await stage.linkedinProfile(request);
      if (output && (output.about?.text.trim() || output.places.length > 0)) return output;
      onStageFailure(stage.provenance?.model ?? 'unknown', new Error('invalid_answer'));
    } catch (error) {
      onStageFailure(stage.provenance?.model ?? 'unknown', error);
    }
  }
  return null;
}

export function buildExperienceFactRewriter(config: {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  readonly vertex?: VertexConfig;
  /** Учётный `fetch` механики `experienceBullets`; без него ступень Vertex не строится. */
  readonly vertexFetch?: typeof fetch;
  readonly onStageFailure?: (model: string, error: unknown) => void;
}): ExperienceFactRewriter | undefined {
  const stages = resolveChain(
    MODEL_CHAINS.experienceBullets,
    config.providerCredentials ?? {},
    config.vertexFetch ? config.vertex : undefined,
  );
  if (stages.length === 0) return undefined;
  return new QueuedExperienceFactRewriter(
    stages.map((stage) =>
      stage.kind === 'vertex'
        ? // Vertex первым (04.11): те же промпты, схемы и проверки ответа, транспорт через учёт.
          new LlmExperienceFactRewriter({
            apiKey: '',
            model: stage.vertex.model,
            client: new VertexJsonClient(stage.vertex, config.vertexFetch!).asChatClient(),
          })
        : new LlmExperienceFactRewriter({
            apiKey: stage.route.apiKey,
            model: stage.route.model,
            baseUrl:
              stage.route.provider === 'openai'
                ? undefined
                : modelRegistry[stage.route.provider].baseUrl,
            structuredOutput:
              modelRegistry[stage.route.provider].models.find(
                (item) => item.id === stage.route.model,
              )?.structuredOutput ?? true,
          }),
    ),
    config.onStageFailure,
  );
}
