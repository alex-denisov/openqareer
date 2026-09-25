import OpenAI from 'openai';
import {
  COVER_LETTER_JSON_SCHEMA,
  coverLetterBodySchema,
  coverLetterInstructions,
} from '../domain/coverLetterWriting';
import {
  trimIncompleteFinalSentence,
  type PitchLanguage,
  type PitchTone,
} from '../domain/vacancyPitchService';
import { rankPitchFacts } from '../domain/pitchFactRanking';
import type { ChatCompletionClient } from './roleNamer';
import { isMutableModelAlias, modelRegistry, type ProviderId } from './modelRegistry';
import { selectProviderQueue, type ProviderQueueEntry, type ProviderRoute } from './providerQueue';
import { PROVIDER_STAGE_MAX_RETRIES, PROVIDER_STAGE_TIMEOUT_MS } from './stageTimeout';

/** Столько же, сколько идёт в называние ролей — тот же входной бюджет (B266). */
const MAX_FACTS = 40;
const MAX_STATEMENT = 400;
const MAX_TITLE = 200;
const MAX_REQUIREMENT = 120;
const MAX_REQUIREMENTS = 20;

/** Письмо должно влезть и без рассуждения, и после JSON-обёртки. */
export const COVER_LETTER_ANSWER_TOKENS = 1_500;
/** Рассуждающая модель делит этот же потолок между мыслью и письмом (B266). */
export const COVER_LETTER_REASONING_TOKENS = 4_096;

export function coverLetterOutputBudget(thinkingLevel?: 'low' | 'high'): number {
  return thinkingLevel ? COVER_LETTER_REASONING_TOKENS : COVER_LETTER_ANSWER_TOKENS;
}

function outputLimit(provider: ProviderId, thinkingLevel?: 'low' | 'high'): Record<string, number> {
  const budget = coverLetterOutputBudget(thinkingLevel);
  // Новые модели OpenAI принимают только современное имя; OpenRouter и его
  // совместимые модели по-прежнему ждут старое имя параметра.
  return provider === 'openai'
    ? { max_completion_tokens: budget }
    : { max_tokens: budget };
}

export interface CoverLetterFact {
  readonly ref: string;
  readonly statement: string;
  readonly domain?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface CoverLetterVacancy {
  readonly title: string;
  readonly company?: string;
  readonly description?: string;
  readonly requirements?: readonly string[];
}

export interface CoverLetterWriteInput {
  readonly facts: readonly CoverLetterFact[];
  readonly vacancy: CoverLetterVacancy;
  readonly language: PitchLanguage;
  readonly tone: PitchTone;
}

export type CoverLetterFailureKind =
  'http_error' | 'timeout' | 'transport_error' | 'unusable_response';

export interface CoverLetterFailure {
  readonly stage: string;
  readonly kind: CoverLetterFailureKind;
  readonly status?: number;
  readonly detail?: string;
}

export interface CoverLetterOutcome {
  readonly body?: string;
  readonly stage?: string;
  readonly failure?: CoverLetterFailure;
}

export interface CoverLetterWriter {
  writeCoverLetter(input: CoverLetterWriteInput): Promise<CoverLetterOutcome>;
}

/**
 * Общий срок на письмо. Очередь ждёт до 50 с на ступень, а запрос письма на
 * клиенте без таймаута: без срока кандидат минутами смотрел бы на спиннер.
 * По истечении срока идёт шаблон (B266, пункт 7).
 */
export const COVER_LETTER_BUDGET_MS = 25_000;

export async function withinTimeBudget(
  writing: Promise<CoverLetterOutcome>,
  budgetMs: number,
): Promise<CoverLetterOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<CoverLetterOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ failure: { stage: 'budget', kind: 'timeout' } }), budgetMs);
  });
  try {
    return await Promise.race([writing, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Ключ провайдера не покидает процесс даже в логе (тот же уговор, что и у роли). */
function failureDetail(text: string, apiKey: string): string | undefined {
  const trimmed = text.trim().slice(0, 600);
  if (trimmed.length === 0) return undefined;
  return apiKey.length > 0 ? trimmed.split(apiKey).join('[REDACTED]') : trimmed;
}

function thrownFailure(stage: string, error: unknown, apiKey: string): CoverLetterFailure {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError' || name === 'APIConnectionTimeoutError') {
    return { stage, kind: 'timeout' };
  }
  const status =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown }).status
      : undefined;
  const detail = failureDetail(error instanceof Error ? error.message : String(error), apiKey);
  return typeof status === 'number'
    ? { stage, kind: 'http_error', status, ...(detail ? { detail } : {}) }
    : { stage, kind: 'transport_error', ...(detail ? { detail } : {}) };
}

/** Та же осторожность с фигурной/квадратной скобкой, что и у называния ролей. */
function jsonPayload(content: string): string | null {
  const brace = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return brace >= 0 && end > brace ? content.slice(brace, end + 1) : null;
}

/**
 * Ответ отклоняется, если модель всё же оставила заглушку («[Имя]») или
 * упомянула механику сбора данных — рекрутер не должен это увидеть (B266).
 */
function hasPlaceholder(body: string): boolean {
  return /[[\]]/u.test(body);
}

function mentionsImportOrMatching(body: string): boolean {
  return /импорт(?:ировал|ировано|а резюме)?|подбор(?:а)? вакансий|сопоставлени[ея]|imported (?:a|the|his|her) (?:resume|profile)|resume import|job matching/iu.test(
    body,
  );
}

function parseBody(content: string | null): string | null {
  if (!content) return null;
  const payload = jsonPayload(content);
  if (!payload) return null;
  try {
    const parsed = coverLetterBodySchema.safeParse(JSON.parse(payload));
    if (!parsed.success) return null;
    const body = parsed.data.body.trim();
    if (hasPlaceholder(body) || mentionsImportOrMatching(body)) return null;
    return body;
  } catch {
    return null;
  }
}

function serializeInput(input: CoverLetterWriteInput): string {
  const rankedFacts = rankPitchFacts(input.facts, input.vacancy);
  return JSON.stringify({
    vacancy: {
      title: input.vacancy.title.slice(0, MAX_TITLE),
      ...(input.vacancy.company ? { company: input.vacancy.company.slice(0, MAX_TITLE) } : {}),
      requirements: (input.vacancy.requirements ?? [])
        .slice(0, MAX_REQUIREMENTS)
        .map((requirement) => requirement.slice(0, MAX_REQUIREMENT)),
    },
    facts: rankedFacts.slice(0, MAX_FACTS).map((fact) => ({
      ref: fact.ref,
      statement: fact.statement.slice(0, MAX_STATEMENT),
    })),
  });
}

export interface LlmCoverLetterWriterOptions {
  apiKey: string;
  model: string;
  /** Провайдер определяет имя параметра потолка вывода. */
  provider?: ProviderId;
  /** Уровень рассуждения модели из реестра требует общего запаса токенов. */
  thinkingLevel?: 'low' | 'high';
  baseUrl?: string;
  timeoutMs?: number;
  structuredOutput?: boolean;
  requireParameters?: boolean;
  /** Имя ступени в очереди — оно же уходит в провенанс ответа. */
  stage?: string;
  client?: ChatCompletionClient;
}

/**
 * Один узкий вызов: факты и вакансия внутрь, готовое письмо наружу.
 *
 * Намеренно не переиспользует `LlmRoleNamer` — контракты разные (JSON-схема,
 * инструкция и проверки ответа), но узкий клиентский тип и приём отказа те
 * же, что у него, поэтому `ChatCompletionClient` импортирован оттуда, а не
 * продублирован (`roleNamer.ts`).
 */
export class LlmCoverLetterWriter implements CoverLetterWriter {
  private readonly client: ChatCompletionClient;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly structuredOutput: boolean;
  private readonly requireParameters: boolean;
  private readonly stage: string;
  private readonly provider: ProviderId;
  private readonly thinkingLevel: 'low' | 'high' | undefined;

  constructor(options: LlmCoverLetterWriterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.provider = options.provider ?? 'openai';
    this.thinkingLevel = options.thinkingLevel;
    this.stage = options.stage ?? options.model;
    this.structuredOutput = options.structuredOutput ?? false;
    this.requireParameters = options.requireParameters ?? false;
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        timeout: options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS,
        maxRetries: PROVIDER_STAGE_MAX_RETRIES,
      }) as unknown as ChatCompletionClient);
  }

  async writeCoverLetter(input: CoverLetterWriteInput): Promise<CoverLetterOutcome> {
    // Фактов нет — спрашивать модель не о чем, это не отказ провайдера.
    if (input.facts.length === 0) return {};
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: coverLetterInstructions(input.language, input.tone) },
          { role: 'user', content: serializeInput(input) },
        ],
        ...outputLimit(this.provider, this.thinkingLevel),
        ...(this.structuredOutput
          ? {
              response_format: { type: 'json_schema', json_schema: COVER_LETTER_JSON_SCHEMA },
              ...(this.requireParameters ? { provider: { require_parameters: true } } : {}),
            }
          : {}),
      });
      const choice = response.choices[0] as
        | (typeof response.choices)[number] & { finish_reason?: string | null }
        | undefined;
      const parsedBody = parseBody(choice?.message?.content ?? null);
      const body =
        parsedBody && choice?.finish_reason === 'length'
          ? trimIncompleteFinalSentence(parsedBody)
          : parsedBody;
      return body
        ? { body, stage: this.stage }
        : { failure: { stage: this.stage, kind: 'unusable_response' } };
    } catch (error) {
      return { failure: thrownFailure(this.stage, error, this.apiKey) };
    }
  }
}

/**
 * Письмо говорит на `chat/completions`, как и называние ролей: ступень с
 * другим транспортом (Gemini) сюда не идёт — звать её этим клиентом значило
 * бы получить отказ и выдать его за молчание модели.
 */
function speaksChatCompletions(provider: ProviderId): boolean {
  return provider === 'openai' || modelRegistry[provider].transport === 'openai-compatible-chat';
}

function writerForRoute(route: ProviderRoute): LlmCoverLetterWriter {
  const definition = modelRegistry[route.provider].models.find((item) => item.id === route.model);
  return new LlmCoverLetterWriter({
    apiKey: route.apiKey,
    model: route.model,
    provider: route.provider,
    stage: `${route.provider}:${route.model}`,
    baseUrl: route.provider === 'openai' ? undefined : modelRegistry[route.provider].baseUrl,
    structuredOutput: definition?.structuredOutput ?? false,
    thinkingLevel: definition?.thinkingLevel,
    requireParameters: route.provider === 'openrouter' && isMutableModelAlias(route.model),
  });
}

/** Очередь ступеней письма: молчание одной — повод спросить следующую. */
export class QueuedCoverLetterWriter implements CoverLetterWriter {
  constructor(
    private readonly stages: readonly CoverLetterWriter[],
    readonly descriptors: readonly string[] = [],
  ) {}

  async writeCoverLetter(input: CoverLetterWriteInput): Promise<CoverLetterOutcome> {
    let lastFailure: CoverLetterFailure | undefined;
    for (const stage of this.stages) {
      const outcome = await stage.writeCoverLetter(input);
      if (outcome.body) return outcome;
      lastFailure = outcome.failure ?? lastFailure;
    }
    return lastFailure ? { failure: lastFailure } : {};
  }
}

export interface CoverLetterWriterConfig {
  readonly personalProvider?: ProviderId;
  readonly model?: string;
  readonly fallbacks?: readonly ProviderQueueEntry[];
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
}

export function buildCoverLetterWriter(
  config: CoverLetterWriterConfig,
): CoverLetterWriter | undefined {
  const provider: ProviderId = config.personalProvider ?? 'openai';
  const stages = selectProviderQueue({
    head: { provider, ...(config.model ? { model: config.model } : {}) },
    fallbacks: config.fallbacks,
    credentials: config.providerCredentials ?? {},
  }).filter((route) => speaksChatCompletions(route.provider));
  if (stages.length === 0) return undefined;

  return new QueuedCoverLetterWriter(
    stages.map(writerForRoute),
    stages.map((route) => `${route.provider}:${route.model}`),
  );
}
