import { MODEL_CHAINS, resolveChain } from './modelChains';
import OpenAI from 'openai';
import { COVER_LETTER_MAX_CHARS, coverLetterInstructions } from '../domain/coverLetterWriting';
import {
  trimIncompleteFinalSentence,
  type PitchLanguage,
  type PitchTone,
} from '../domain/vacancyPitchService';
import { rankPitchFacts, type PitchFactRankingContext } from '../domain/pitchFactRanking';
import type { ChatCompletionClient } from './roleNamer';
import { modelRegistry, type ProviderId } from './modelRegistry';
import { GeminiCoverLetterWriter } from './geminiCoverLetterWriter';
import { VertexTokenProvider, vertexPublisherBaseUrl, type VertexConfig } from './vertexAi';
import type { ProviderRoute } from './providerQueue';
import { PROVIDER_STAGE_MAX_RETRIES, PROVIDER_STAGE_TIMEOUT_MS } from './stageTimeout';
import {
  assertOpenRouterModelForPersonalData,
  isOpenRouterBaseUrl,
  openRouterRouting,
} from './openRouterPrivacy';

/** Модели нужен весь профиль: на семи фактах письма выходили обрывочными (замер 05.11). */
const MAX_FACTS = 30;
const MAX_STATEMENT = 400;
const MAX_TITLE = 200;
const MAX_REQUIREMENT = 120;
const MAX_REQUIREMENTS = 20;
/** Хватает на задачи и требования: дальше в текстах вакансий идут условия и юридический текст. */
const MAX_DESCRIPTION = 3_600;

/** Рассуждение и письмо делят один потолок: у DeepSeek low вывод доходил до 4 156 токенов (05.11). */
export const COVER_LETTER_OUTPUT_TOKENS = 6_000;
/** Письмо живее и связнее с коротким рассуждением; полное в 2,7 раза дороже и не лучше (05.11). */
const LETTER_REASONING = { effort: 'low' } as const;

function outputLimit(provider: ProviderId): Record<string, number> {
  // Новые модели OpenAI принимают только современное имя; OpenRouter и его
  // совместимые модели по-прежнему ждут старое имя параметра.
  return provider === 'openai'
    ? { max_completion_tokens: COVER_LETTER_OUTPUT_TOKENS }
    : { max_tokens: COVER_LETTER_OUTPUT_TOKENS };
}

export interface CoverLetterFact {
  readonly ref: string;
  readonly statement: string;
  readonly domain?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  /** Кандидат подтвердил факт или он ещё ждёт подтверждения (C46, ранжирование фактов). */
  readonly status?: 'proposed' | 'confirmed' | 'corrected';
  /** Компания, к которой факт привязан в профиле; `null` — места нет, приписывать нельзя. */
  readonly workplace?: string | null;
}

export interface CoverLetterVacancy {
  readonly title: string;
  readonly company?: string;
  readonly description?: string;
  readonly requirements?: readonly string[];
  /** Не попадает в текст вакансии: только задаёт порядок фактов в промпте. */
  readonly rankingContext?: PitchFactRankingContext;
  readonly recipient?: {
    readonly name?: string;
    readonly role?: string;
  };
  /** B422: кандидат отметил компанию «Хочу в эту компанию». */
  readonly targetCompany?: true;
}

/** Место работы на языке письма: модель пишет должность и компанию дословно. */
export interface CoverLetterCareerEntry {
  readonly title?: string;
  readonly employer?: string;
  readonly years?: string;
}

export interface CoverLetterWriteInput {
  readonly facts: readonly CoverLetterFact[];
  readonly career?: readonly CoverLetterCareerEntry[];
  readonly vacancy: CoverLetterVacancy;
  readonly language: PitchLanguage;
  readonly tone: PitchTone;
  /** Названия нарушенных правил письма; очередь отдаёт отклонённое письмо следующей ступени. */
  readonly review?: (body: string) => readonly string[];
}

/** Спрашивать модель не о чем: это не отказ провайдера. */
export function hasLetterInput(input: CoverLetterWriteInput): boolean {
  return input.facts.length > 0 || (input.career?.length ?? 0) > 0;
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
 * Общий срок на письмо: по его истечении идёт шаблон. Потолки взяты из замера 05.11, а не заданы заранее:
 * DeepSeek low p50 10,7 с, 7 из 8 писем до 16 с; Gemini low максимум 5,5 с; luna максимум 7,5 с.
 * Срока хватает на DeepSeek и Gemini; luna успевает, только если Gemini отказала сразу (кредит кончился).
 */
export const COVER_LETTER_BUDGET_MS = 24_000;
const VERTEX_LETTER_STAGE_MS = 6_000;
const OPENROUTER_LETTER_STAGE_MS = 16_000;
const OPENAI_LETTER_STAGE_MS = 8_000;

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
export function failureDetail(text: string, apiKey: string): string | undefined {
  const trimmed = text.trim().slice(0, 600);
  if (trimmed.length === 0) return undefined;
  return apiKey.length > 0 ? trimmed.split(apiKey).join('[REDACTED]') : trimmed;
}

export function thrownFailure(stage: string, error: unknown, apiKey: string): CoverLetterFailure {
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

/** Прод 25.09: бесплатный провайдер закрывал JSON посреди фразы с `finish_reason: stop`,
 * поэтому обрыв узнаётся и по самому тексту, а не только по причине остановки. */
function endsMidSentence(body: string): boolean {
  return !/[.!?…](?:["'»”)\]]+)?$/u.test(body.trim());
}

/**
 * Прод 25.09: gemini-3.8-flash писал 1 750–1 900 знаков при пределе 1 800, и
 * отказ всего письма отдавал очередь медленным ступеням. Лишнее срезается по
 * последнему законченному предложению в пределах лимита.
 */
function clipToLimit(body: string): string {
  if (body.length <= COVER_LETTER_MAX_CHARS) return body;
  return trimIncompleteFinalSentence(body.slice(0, COVER_LETTER_MAX_CHARS));
}

/** Обращение добавляет система: первая строка-приветствие в письме его бы удвоила. */
const GREETING_LINE = /^(?:здравствуйте|добрый день|уважаем\p{L}+|dear|hello|hi)(?!\p{L})[^\n]{0,60}\n+/iu;

function parseBody(content: string | null): string | null {
  const text = content?.trim().replace(GREETING_LINE, '').trim();
  if (!text) return null;
  const body = clipToLimit(text);
  return hasPlaceholder(body) || mentionsImportOrMatching(body) ? null : body;
}

/**
 * Общая приёмка ответа любой ступени: текст без заглушек и без оборванного хвоста. Обрыв узнаётся и по
 * причине остановки, и по тексту.
 */
export function acceptModelBody(
  content: string | null,
  cutByLimit: boolean,
  stage: string,
): CoverLetterOutcome {
  const parsedBody = parseBody(content);
  const body =
    parsedBody && (cutByLimit || endsMidSentence(parsedBody))
      ? trimIncompleteFinalSentence(parsedBody)
      : parsedBody;
  return body ? { body, stage } : { failure: { stage, kind: 'unusable_response' } };
}

function vacancyText(description: string | undefined): string {
  return (description ?? '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, MAX_DESCRIPTION);
}

function placeLine(place: CoverLetterCareerEntry, facts: readonly CoverLetterFact[]): string {
  const head = [place.title, place.employer, place.years].filter(Boolean).join(', ');
  const own = facts.filter((fact) => fact.workplace && fact.workplace === place.employer);
  return `- ${[head, ...own.map((fact) => fact.statement)].join('. ')}`;
}

function vacancySection(input: CoverLetterWriteInput): string[] {
  const { vacancy } = input;
  const description = vacancyText(vacancy.description);
  const requirements = (vacancy.requirements ?? [])
    .slice(0, MAX_REQUIREMENTS)
    .map((requirement) => requirement.slice(0, MAX_REQUIREMENT));
  return [
    'ВАКАНСИЯ',
    `Название: ${vacancy.title.slice(0, MAX_TITLE)}`,
    ...(vacancy.company ? [`Компания: ${vacancy.company.slice(0, MAX_TITLE)}`] : []),
    ...(vacancy.recipient?.name || vacancy.recipient?.role
      ? [`Получатель: ${[vacancy.recipient.name, vacancy.recipient.role].filter(Boolean).join(', ')}`]
      : []),
    ...(requirements.length ? [`Требования: ${requirements.join(', ')}`] : []),
    ...(description ? [description] : []),
    ...(vacancy.targetCompany
      ? ['Кандидат отметил, что хочет работать именно в этой компании: можно сказать об этом одной фразой, не придумывая причин.']
      : []),
  ];
}

function profileSection(input: CoverLetterWriteInput): string[] {
  const ranked = rankPitchFacts(input.facts, input.vacancy, input.vacancy.rankingContext)
    .slice(0, MAX_FACTS)
    .map((fact) => ({ ...fact, statement: fact.statement.slice(0, MAX_STATEMENT) }));
  const employers = new Set((input.career ?? []).flatMap((place) => (place.employer ? [place.employer] : [])));
  const free = ranked.filter((fact) => !fact.workplace || !employers.has(fact.workplace));
  return [
    'ПРОФИЛЬ КАНДИДАТА',
    ...(input.career?.length ? ['Места работы:', ...input.career.map((place) => placeLine(place, ranked))] : []),
    ...(free.length ? ['Опыт, навыки и достижения (компания не указана):', ...free.map((fact) => `- ${fact.statement}`)] : []),
  ];
}

/** Обычный текст, как резюме и вакансия на столе: на JSON модели писали заявку, а не письмо (замер 05.11). */
export function serializeInput(input: CoverLetterWriteInput): string {
  return [...vacancySection(input), '', ...profileSection(input)].join('\n');
}

export interface LlmCoverLetterWriterOptions {
  apiKey: string;
  model: string;
  /** Провайдер определяет имя параметра потолка вывода. */
  provider?: ProviderId;
  baseUrl?: string;
  timeoutMs?: number;
  /** Имя ступени в очереди — оно же уходит в провенанс ответа. */
  stage?: string;
  client?: ChatCompletionClient;
}

/**
 * Один узкий вызов: факты и вакансия внутрь, готовое письмо наружу.
 *
 * Намеренно не переиспользует `LlmRoleNamer`: контракты разные, но узкий клиентский тип и приём отказа
 * те же, поэтому `ChatCompletionClient` импортирован оттуда (`roleNamer.ts`).
 */
export class LlmCoverLetterWriter implements CoverLetterWriter {
  private readonly openRouter: boolean;
  private readonly client: ChatCompletionClient;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly stage: string;
  private readonly provider: ProviderId;
  private readonly timeoutMs: number;

  constructor(options: LlmCoverLetterWriterOptions) {
    this.timeoutMs = options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.provider = options.provider ?? 'openai';
    this.stage = options.stage ?? options.model;
    // A letter is built from the candidate's facts: on OpenRouter it is never collected (28.10).
    this.openRouter = isOpenRouterBaseUrl(options.baseUrl);
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        timeout: this.timeoutMs,
        maxRetries: PROVIDER_STAGE_MAX_RETRIES,
      }) as unknown as ChatCompletionClient);
  }

  async writeCoverLetter(input: CoverLetterWriteInput): Promise<CoverLetterOutcome> {
    if (!hasLetterInput(input)) return {};
    // Таймаут клиента кончается на заголовках, а OpenRouter шлёт их сразу: письма шли и 22 с при потолке 16 (05.11).
    const deadline = AbortSignal.timeout(this.timeoutMs);
    try {
      if (this.openRouter) assertOpenRouterModelForPersonalData(this.model);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: coverLetterInstructions(input.language, input.tone) },
          { role: 'user', content: serializeInput(input) },
        ],
        ...outputLimit(this.provider),
        ...(this.openRouter ? { reasoning: LETTER_REASONING } : {}),
        ...openRouterRouting({ personal: this.openRouter, requireParameters: false }),
      }, { signal: deadline });
      const choice = response.choices[0] as
        ((typeof response.choices)[number] & { finish_reason?: string | null }) | undefined;
      return acceptModelBody(
        choice?.message?.content ?? null,
        choice?.finish_reason === 'length',
        this.stage,
      );
    } catch (error) {
      if (deadline.aborted) return { failure: { stage: this.stage, kind: 'timeout' } };
      return { failure: thrownFailure(this.stage, error, this.apiKey) };
    }
  }
}

function writerForRoute(route: ProviderRoute): LlmCoverLetterWriter {
  return new LlmCoverLetterWriter({
    apiKey: route.apiKey,
    model: route.model,
    provider: route.provider,
    stage: `${route.provider}:${route.model}`,
    baseUrl: route.provider === 'openai' ? undefined : modelRegistry[route.provider].baseUrl,
    timeoutMs: route.provider === 'openai' ? OPENAI_LETTER_STAGE_MS : OPENROUTER_LETTER_STAGE_MS,
  });
}

/**
 * Отказ каждой ступени — в журнал сервера: раньше виден был только общий срок,
 * и отбракованный ответ Vertex выглядел как медленная очередь (прод 25.09).
 */
function logStageFailure(failure: CoverLetterFailure): void {
  console.warn(JSON.stringify({ event: 'cover-letter-stage-refused', ...failure }));
}

/** В журнал уходят только названия правил: письмо — текст кандидата. */
function reviewed(outcome: CoverLetterOutcome, input: CoverLetterWriteInput): CoverLetterOutcome {
  if (!outcome.body) return outcome;
  const rules = input.review?.(outcome.body) ?? [];
  if (rules.length === 0) return outcome;
  const detail = `letter_gate:${[...new Set(rules)].join(',')}`;
  return { failure: { stage: outcome.stage ?? 'unknown', kind: 'unusable_response', detail } };
}

/** Очередь ступеней письма: молчание одной — повод спросить следующую. */
export class QueuedCoverLetterWriter implements CoverLetterWriter {
  constructor(
    private readonly stages: readonly CoverLetterWriter[],
    readonly descriptors: readonly string[] = [],
    private readonly onStageFailure: (failure: CoverLetterFailure) => void = logStageFailure,
  ) {}

  async writeCoverLetter(input: CoverLetterWriteInput): Promise<CoverLetterOutcome> {
    let lastFailure: CoverLetterFailure | undefined;
    for (const stage of this.stages) {
      const outcome = reviewed(await stage.writeCoverLetter(input), input);
      if (outcome.body) return outcome;
      if (outcome.failure) this.onStageFailure(outcome.failure);
      lastFailure = outcome.failure ?? lastFailure;
    }
    return lastFailure ? { failure: lastFailure } : {};
  }
}

export interface CoverLetterWriterConfig {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  /** Gemini на Vertex — последняя ступень цепочки, когда настроен (B580, 29.10). */
  readonly vertex?: VertexConfig;
  /** Metered `fetch` of the Vertex stage (04.11): books the call and enforces the daily cap. */
  readonly vertexFetch?: typeof fetch;
}

/**
 * Цепочка письма (решение владельца 05.11): DeepSeek, затем Gemini, затем luna на случай, когда кредит
 * Vertex кончился; шаблон остаётся запасом за ней.
 */
export function buildCoverLetterWriter(
  config: CoverLetterWriterConfig,
): CoverLetterWriter | undefined {
  const stages = resolveChain(
    MODEL_CHAINS.coverLetters,
    config.providerCredentials ?? {},
    config.vertex,
  );
  if (stages.length === 0) return undefined;
  return new QueuedCoverLetterWriter(
    stages.map((stage) =>
      stage.kind === 'vertex' ? vertexCoverLetterWriter(stage.vertex, config.vertexFetch) : writerForRoute(stage.route),
    ),
    stages.map((stage) => stage.label),
    logStageFailure,
  );
}

/**
 * D-F9, 05.11: 7 писем модели из 10 на проде исказили опыт кандидата (приписанная работа, усиленная
 * роль), и текст идёт от его имени. Пока выключено: письмо пишет шаблон, модель не вызывается.
 * Включать только после вычитки CPO.
 */
export const LETTER_MODEL_ENABLED = false;

/** То, что получает прод: без цепочки маршрут пишет письмо шаблоном и не тратит ни денег, ни времени. */
export function buildEnabledCoverLetterWriter(
  config: CoverLetterWriterConfig,
  enabled: boolean = LETTER_MODEL_ENABLED,
): CoverLetterWriter | undefined {
  return enabled ? buildCoverLetterWriter(config) : undefined;
}

function vertexCoverLetterWriter(vertex: VertexConfig, fetchImpl?: typeof fetch): CoverLetterWriter {
  const tokens = new VertexTokenProvider(vertex, fetchImpl);
  return new GeminiCoverLetterWriter({
    ...(fetchImpl ? { fetchImpl } : {}),
    apiKey: '',
    model: vertex.model,
    stage: `vertex:${vertex.model}`,
    baseUrl: vertexPublisherBaseUrl(vertex),
    authHeaders: async () => ({ Authorization: `Bearer ${await tokens.token()}` }),
    thinkingLevel: 'low',
    retriesOn429: 1,
    timeoutMs: VERTEX_LETTER_STAGE_MS,
  });
}
