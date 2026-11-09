import { MODEL_CHAINS, resolveChain } from './modelChains';
import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import {
  COVER_LETTER_MAX_CHARS,
  coverLetterPrompt,
  type LetterGender,
} from '../domain/coverLetterWriting';
import type { ChatCompletionClient } from './roleNamer';
import { modelRegistry, type ProviderId } from './modelRegistry';
import { GeminiCoverLetterWriter } from './geminiCoverLetterWriter';
import { splitSignatureLine } from '../domain/letterSignature';
import { VertexTokenProvider, vertexPublisherBaseUrl, type VertexConfig } from './vertexAi';
import type { ProviderRoute } from './providerQueue';
import { PROVIDER_STAGE_MAX_RETRIES, PROVIDER_STAGE_TIMEOUT_MS } from './stageTimeout';
import {
  assertOpenRouterModelForPersonalData,
  isOpenRouterBaseUrl,
  openRouterRouting,
} from './openRouterPrivacy';

/** Защита от сбоя источника, а не выжимка: письмо пишется по полному тексту вакансии (B601). */
const MAX_VACANCY_CHARS = 30_000;

/**
 * Рассуждение и письмо делят один потолок. DeepSeek при 6 000 отдавал пустые письма: всё уходило на
 * рассуждение (B601, 06.11); при 24 000 письма принял владелец. Деньги идут за токены, а не за потолок.
 */
export const COVER_LETTER_OUTPUT_TOKENS = 24_000;
/** Письмо принято на рассуждении `low` у OpenRouter и `high` у Gemini: другие настройки не проверялись. */
const OPENROUTER_LETTER_REASONING = { effort: 'low' } as const;

function outputLimit(provider: ProviderId): Record<string, number> {
  // Новые модели OpenAI принимают только современное имя; OpenRouter и его
  // совместимые модели по-прежнему ждут старое имя параметра.
  return provider === 'openai'
    ? { max_completion_tokens: COVER_LETTER_OUTPUT_TOKENS }
    : { max_tokens: COVER_LETTER_OUTPUT_TOKENS };
}

export interface CoverLetterVacancy {
  readonly title: string;
  readonly company?: string;
  readonly location?: string;
  /** Полный текст вакансии, а не сводка кластера. */
  readonly description?: string;
  readonly responsibilities?: readonly string[];
  readonly requirements?: readonly string[];
  readonly recipient?: {
    readonly name?: string;
    readonly role?: string;
  };
}

export interface CoverLetterWriteInput {
  /** Весь мастер-профиль обычным текстом (`letterProfileText`). */
  readonly profile: string;
  readonly vacancy: CoverLetterVacancy;
  readonly gender?: LetterGender;
  /** Язык, который кандидат выбрал сам; без него письмо идёт на языке вакансии. */
  readonly chosenLanguage?: 'en' | 'ru';
  /** `false` — резюме не приложится: запрос не просит фразу о приложении. */
  readonly resumeAttached?: boolean;
  /** Названия нарушенных правил письма; очередь отдаёт отклонённое письмо следующей ступени. */
  readonly review?: (body: string) => readonly string[];
  /** Имя из профиля как есть: модель возвращает его на языке письма (B624). */
  readonly candidateName?: string;
}

/** Спрашивать модель не о чем: это не отказ провайдера. */
export function hasLetterInput(input: CoverLetterWriteInput): boolean {
  return input.profile.trim().length > 0;
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
  /** Имя для подписи, как его вернула модель; проверяет его вызывающий (B624). */
  readonly senderName?: string;
  readonly failure?: CoverLetterFailure;
}

export interface CoverLetterWriter {
  writeCoverLetter(input: CoverLetterWriteInput): Promise<CoverLetterOutcome>;
}

/**
 * Сроки письма (B601, 06.11). Письмо по полному профилю идёт с рассуждением, и старые сроки (ступень
 * 4,5 с, всё письмо 12 с) обрывали DeepSeek раньше ответа. Замер 06.11 на Сбере: DeepSeek без выбора
 * провайдера 5–33 с (OpenRouter выбирает разных, заголовки приходят за 1–4 с), с выбором по скорости
 * вывода 5–14 с; GLM 2–8 с; Gemini с рассуждением high 21–60 с, и один вызов из двенадцати упёрся в 60 с.
 * У DeepSeek и GLM потолок с запасом над этими цифрами; у Gemini запаса нет, она последняя ступень.
 */
const DEEPSEEK_LETTER_STAGE_MS = 25_000;
const GLM_LETTER_STAGE_MS = 15_000;
const VERTEX_LETTER_STAGE_MS = 60_000;
/** Потолок учётного fetch Vertex на прод: его потолок для кандидата (18 с) оборвал бы письмо раньше ступени. */
export const COVER_LETTER_VERTEX_TIMEOUT_MS = VERTEX_LETTER_STAGE_MS;
/** Сумма ступеней: каждая успевает ответить даже после отказа предыдущей. */
export const COVER_LETTER_BUDGET_MS =
  2 * DEEPSEEK_LETTER_STAGE_MS + GLM_LETTER_STAGE_MS + VERTEX_LETTER_STAGE_MS;

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
  // У ошибок SDK поле name равно 'Error': их узнаём по классу.
  if (name === 'TimeoutError' || name === 'AbortError' || error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) {
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

/** Только служебная механика: «импортозамещение» и «импорт оборудования» — слова профессии. */
function mentionsImportOrMatching(body: string): boolean {
  return /импорт\p{L}*\s+(?:резюме|профил)|подбор\p{L}*\s+вакансий|imported (?:a|the|his|her) (?:resume|profile)|resume import|job matching/iu.test(
    body,
  );
}

/** Прод 25.09: провайдер закрывал ответ посреди фразы с `finish_reason: stop`. */
function endsMidSentence(body: string): boolean {
  return !/[.!?…](?:["'»”)\]]+)?$/u.test(body);
}

/** Почему ответ не письмо; в журнал уходит только причина, не текст кандидата. */
function refusalReason(body: string, cutByLimit: boolean): string | undefined {
  if (body.length === 0) return 'empty';
  if (cutByLimit || endsMidSentence(body)) return 'cut';
  if (body.length > COVER_LETTER_MAX_CHARS) return 'too_long';
  if (hasPlaceholder(body)) return 'placeholder';
  return mentionsImportOrMatching(body) ? 'service_text' : undefined;
}

/** Подпись ставит система: «С уважением,» модели (запрос это запрещает, но бывает) не обрыв письма. */
function withoutClosingLine(body: string): string {
  return body.replace(/\n\s*(?:с уважением|best regards|kind regards|regards|sincerely)[,.!]?\s*$/iu, '').trim();
}

/**
 * Общая приёмка ответа любой ступени. Письмо не обрезается: в его конце сказано про резюме и
 * предложение обсудить, поэтому оборванный ответ уступает следующей ступени.
 */
export function acceptModelBody(
  content: string | null,
  cutByLimit: boolean,
  stage: string,
): CoverLetterOutcome {
  const signed = splitSignatureLine(content?.trim() ?? '');
  const body = withoutClosingLine(signed.body);
  const detail = refusalReason(body, cutByLimit);
  if (detail) return { failure: { stage, kind: 'unusable_response', detail } };
  return signed.name ? { body, stage, senderName: signed.name } : { body, stage };
}

function plainVacancyText(text: string): string {
  return text
    .replace(/<\/(?:p|li|div|h\d|ul|ol)>|<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function listSection(title: string, items: readonly string[] | undefined): string[] {
  return items?.length ? [title, ...items.map((item) => `- ${item}`)] : [];
}

export function vacancyText(vacancy: CoverLetterVacancy): string {
  return [
    [vacancy.title, vacancy.company].filter(Boolean).join(', '),
    ...(vacancy.location ? [vacancy.location] : []),
    '',
    ...(vacancy.description ? [plainVacancyText(vacancy.description)] : []),
    ...listSection('Обязанности:', vacancy.responsibilities),
    ...listSection('Требования:', vacancy.requirements),
  ].join('\n').slice(0, MAX_VACANCY_CHARS);
}

/** Запрос целиком: один текст от пользователя, как при подборе запроса с владельцем. */
export function letterPrompt(input: CoverLetterWriteInput): string {
  return coverLetterPrompt({
    vacancy: vacancyText(input.vacancy),
    profile: input.profile,
    ...(input.vacancy.recipient ? { recipient: input.vacancy.recipient } : {}),
    ...(input.gender ? { gender: input.gender } : {}),
    ...(input.chosenLanguage ? { chosenLanguage: input.chosenLanguage } : {}),
    ...(input.resumeAttached === false ? { resumeAttached: false } : {}),
    ...(input.candidateName ? { candidateName: input.candidateName } : {}),
  });
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
 * Один узкий вызов: вакансия и профиль внутрь, готовое письмо наружу.
 *
 * Намеренно не переиспользует `LlmRoleNamer`: контракты разные, но узкий
 * клиентский тип и приём отказа те же, поэтому `ChatCompletionClient`
 * импортирован оттуда, а не продублирован (`roleNamer.ts`).
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
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.provider = options.provider ?? 'openai';
    this.timeoutMs = options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS;
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
    try {
      if (this.openRouter) assertOpenRouterModelForPersonalData(this.model);
      // Таймаут клиента ждёт только заголовки, а OpenRouter шлёт их сразу и держит тело: срок на весь ответ.
      const deadline = AbortSignal.timeout(this.timeoutMs);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: letterPrompt(input) }],
        ...outputLimit(this.provider),
        ...(this.openRouter ? { reasoning: OPENROUTER_LETTER_REASONING } : {}),
        ...openRouterRouting({ personal: this.openRouter, fastest: this.openRouter }),
      }, { signal: deadline });
      const choice = response.choices[0] as
        ((typeof response.choices)[number] & { finish_reason?: string | null }) | undefined;
      return acceptModelBody(
        choice?.message?.content ?? null,
        choice?.finish_reason === 'length',
        this.stage,
      );
    } catch (error) {
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
    timeoutMs: route.model.startsWith('deepseek/') ? DEEPSEEK_LETTER_STAGE_MS : GLM_LETTER_STAGE_MS,
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
    for (const [index, stage] of this.stages.entries()) {
      if (index > 0 && this.repeatsSlowStage(index, lastFailure)) continue;
      const written = await stage.writeCoverLetter(input);
      const outcome = reviewed(written, input);
      if (outcome.body) return outcome;
      if (outcome.failure) this.onStageFailure(outcome.failure);
      lastFailure = outcome.failure ?? lastFailure;
    }
    return lastFailure ? { failure: lastFailure } : {};
  }

  /**
   * B601, 10.11: повтор той же модели нужен после отказа проверки или обрыва — следующий ответ другой.
   * После таймаута или ошибки сети провайдер медлит и второй раз: на стенде два таймаута подряд
   * давали письмо через 50–60 с.
   */
  private repeatsSlowStage(index: number, lastFailure: CoverLetterFailure | undefined): boolean {
    const same = this.descriptors[index] !== undefined && this.descriptors[index] === this.descriptors[index - 1];
    return same && lastFailure !== undefined && lastFailure.kind !== 'unusable_response';
  }
}

export interface CoverLetterWriterConfig {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  /** Gemini на Vertex — последняя ступень цепочки, когда настроен (B601). */
  readonly vertex?: VertexConfig;
  /** Metered `fetch` of the Vertex stage (04.11): books the call and enforces the daily cap. */
  readonly vertexFetch?: typeof fetch;
}

/**
 * Цепочка письма (решение владельца, B601; повтор DeepSeek с 10.11): deepseek-v4.1-flash дважды → glm-5.3-flash → Gemini на Vertex;
 * если отказали все, маршрут отвечает ошибкой с повтором, а не шаблоном.
 */
export function buildCoverLetterWriter(
  config: CoverLetterWriterConfig,
): CoverLetterWriter | undefined {
  const stages = coverLetterStages(config);
  if (stages.length === 0) return undefined;
  return new QueuedCoverLetterWriter(
    stages.map((stage) => stage.writer),
    stages.map((stage) => stage.label),
  );
}

/** Ступени цепочки по отдельности: контрольный прогон зовёт каждую модель тем же путём, что и прод. */
export function coverLetterStages(
  config: CoverLetterWriterConfig,
): readonly { readonly label: string; readonly writer: CoverLetterWriter }[] {
  return resolveChain(MODEL_CHAINS.coverLetters, config.providerCredentials ?? {}, config.vertex).map((stage) => ({
    label: stage.label,
    writer: stage.kind === 'vertex'
      ? vertexCoverLetterWriter(stage.vertex, config.vertexFetch)
      : writerForRoute(stage.route),
  }));
}

/** Письмо пишет модель (решение владельца 06.11). Откат: false, письмо снова пишет шаблон. */
export const LETTER_MODEL_ENABLED = true;

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
    thinkingLevel: 'high',
    retriesOn429: 1,
    timeoutMs: VERTEX_LETTER_STAGE_MS,
  });
}
