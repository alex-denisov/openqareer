import {
  retryOn429,
  VertexTokenProvider,
  vertexPublisherBaseUrl,
  type VertexConfig,
} from './vertexAi';
import { createHash } from 'node:crypto';
import { HygienicRoleNamer } from './hygienicRoleNamer';
import OpenAI from 'openai';
import {
  ROLE_NAMING_JSON_SCHEMA,
  roleNamingInstructions,
  roleNamingSchema,
} from '../domain/roleNaming';
import type { RoleNameLanguage } from '../domain/roleNameLanguage';
import {
  cloudflareGatewayHeaders,
  geminiGatewayBaseUrl,
  type CloudflareGatewayConfig,
} from './cloudflareAiGateway';
import { geminiResponseSchema } from './geminiSchema';
import type { NamedRole } from '../../shared/roleProposals';
import { isMutableModelAlias, modelRegistry, type ProviderId } from './modelRegistry';
import { selectProviderQueue, type ProviderQueueEntry, type ProviderRoute } from './providerQueue';
import { PROVIDER_STAGE_MAX_RETRIES, PROVIDER_STAGE_TIMEOUT_MS } from './stageTimeout';

/** Весь профиль в этот вызов не едет: роли называются по подтверждённым фактам. */
const MAX_FACTS = 40;
const MAX_STATEMENT = 400;

/** Узкий срез OpenAI-совместимого клиента, который здесь действительно нужен. */
export interface ChatCompletionClient {
  readonly chat: {
    readonly completions: {
      create(request: Record<string, unknown>): Promise<{
        choices: Array<{ message: { content?: string | null } }>;
      }>;
    };
  };
}

export interface CandidateFact {
  readonly ref: string;
  readonly statement: string;
}

/**
 * Ответ называния вместе с провенансом.
 *
 * Ступень названа наружу, потому что очередь из четырёх моделей молча
 * сдвигается: на проде первый ответ занял то 12, то 66 секунд, и понять по
 * ответу, кто его дал, было нельзя. Отчёт обязан совпадать с поведением (B183).
 * `stage` пуст ровно тогда, когда не ответил никто.
 */
export interface RoleNamingOutcome {
  readonly roles: NamedRole[];
  readonly stage?: string;
  /**
   * Причины молчания ступеней — для лога сервера, не для кандидата.
   *
   * Поле пусто, когда молчать было некому.
   */
  readonly failures?: readonly RoleNamingStageFailure[];
}

/**
 * Почему ступень не назвала роли.
 *
 * INC-035: голова очереди молчала на проде, и по ответу нельзя было отличить
 * исчерпанную квоту от отказа шлюза, таймаута тоннеля или отвергнутой схемы —
 * ступень глотала и код ответа, и текст. `unusable_response` означает «ответ
 * пришёл, ролей из него не вышло»: и разбор не удался, и модель назвала ноль.
 */
export type RoleNamingFailureKind =
  'http_error' | 'timeout' | 'transport_error' | 'unusable_response';

export interface RoleNamingStageFailure {
  readonly stage: string;
  readonly kind: RoleNamingFailureKind;
  readonly status?: number;
  readonly detail?: string;
}

/**
 * Длиннее этого причина отказа ничего оператору не добавляет.
 *
 * Шестьсот, а не триста: живой отказ Gemini на проде 2026-09-03 обрезался
 * ровно перед именем исчерпанной квоты («* Quota ex…»), а именно оно отличает
 * лимит в минуту от лимита в сутки (INC-035).
 */
const MAX_FAILURE_DETAIL = 600;

/** Ключ провайдера не покидает процесс даже в логе. */
function failureDetail(text: string, apiKey: string): string | undefined {
  const trimmed = text.trim().slice(0, MAX_FAILURE_DETAIL);
  if (trimmed.length === 0) return undefined;
  return apiKey.length > 0 ? trimmed.split(apiKey).join('[REDACTED]') : trimmed;
}

/** Отказ приходит то ошибкой транспорта, то таймаутом, то кодом ответа. */
function thrownFailure(stage: string, error: unknown, apiKey: string): RoleNamingStageFailure {
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

export interface RoleNamer {
  /**
   * Пустой список — законный ответ: он означает «модель не назвала».
   *
   * Язык названия приходит снаружи и решается кодом (`roleNameLanguage.ts`):
   * оставлять его модели значило бы менять факт о кандидате вместе с
   * провайдером.
   */
  nameRoles(
    facts: readonly CandidateFact[],
    language: RoleNameLanguage,
  ): Promise<RoleNamingOutcome>;
}

export interface LlmRoleNamerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  structuredOutput?: boolean;
  /**
   * Пул OpenRouter вправе увести вызов к модели без схемы. Просьба о схеме без
   * этого условия пропадала бы молча, а роль оставалась неназванной.
   */
  requireParameters?: boolean;
  /** Имя ступени в очереди — оно же уходит в провенанс ответа. */
  stage?: string;
  client?: ChatCompletionClient;
}

/**
 * Один узкий вызов: факты кандидата внутрь, названия ролей наружу.
 *
 * Намеренно не переиспользует `CoachProvider`: тот контракт тянет фазы беседы,
 * кандидатов в память и карьерные действия, а здесь нужно одно — как рынок
 * называет то, чем кандидат занимался. Тем же рассуждением написан
 * `resumeStructurer.ts`, и это тот же приём.
 */
export class LlmRoleNamer implements RoleNamer {
  private readonly client: ChatCompletionClient;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly structuredOutput: boolean;
  private readonly requireParameters: boolean;
  private readonly stage: string;

  constructor(options: LlmRoleNamerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
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

  async nameRoles(
    facts: readonly CandidateFact[],
    language: RoleNameLanguage,
  ): Promise<RoleNamingOutcome> {
    // Спрашивать модель не о чем — это не отказ провайдера, а отсутствие входа.
    if (facts.length === 0) return { roles: [] };
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: roleNamingInstructions(language) },
          { role: 'user', content: serializeFacts(facts) },
        ],
        // `json_object` у модели без структурированного вывода ломал вызов на
        // проде: OpenRouter отвечал телом без `choices`, и роль не называлась
        // вовсе. Формат просим только там, где он поддержан.
        ...(this.structuredOutput
          ? {
              response_format: { type: 'json_schema', json_schema: ROLE_NAMING_JSON_SCHEMA },
              ...(this.requireParameters ? { provider: { require_parameters: true } } : {}),
            }
          : {}),
      });
      return named(parseRoles(response.choices[0]?.message?.content ?? null), this.stage);
    } catch (error) {
      // Молчание провайдера не должно ронять панель: роль просто не названа.
      // Но причина обязана попасть в лог — иначе отличить квоту от таймаута
      // нечем (INC-035).
      return { roles: [], failures: [thrownFailure(this.stage, error, this.apiKey)] };
    }
  }
}

/**
 * Модель отвечает то объектом, то массивом, то с прозой вокруг. Скобку
 * выбираем по тому, какая встретилась раньше: у голого массива первая
 * фигурная скобка стоит внутри него, и жадный поиск по ней вырезал бы один
 * элемент вместо всего списка.
 */
function jsonPayload(content: string): string | null {
  const brace = content.indexOf('{');
  const bracket = content.indexOf('[');
  const first =
    bracket >= 0 && (brace < 0 || bracket < brace)
      ? ([bracket, content.lastIndexOf(']')] as const)
      : ([brace, content.lastIndexOf('}')] as const);
  const [start, end] = first;
  return start >= 0 && end > start ? content.slice(start, end + 1) : null;
}

function serializeFacts(facts: readonly CandidateFact[]): string {
  return JSON.stringify({
    facts: facts.slice(0, MAX_FACTS).map((fact) => ({
      ref: fact.ref,
      statement: fact.statement.slice(0, MAX_STATEMENT),
    })),
  });
}

/** Ступень называется только когда она действительно назвала роли. */
function named(roles: NamedRole[], stage: string): RoleNamingOutcome {
  return roles.length > 0
    ? { roles, stage }
    : { roles: [], failures: [{ stage, kind: 'unusable_response' }] };
}

function parseRoles(content: string | null): NamedRole[] {
  if (!content) return [];
  const payload = jsonPayload(content);
  if (!payload) return [];
  try {
    const parsed = roleNamingSchema.safeParse(JSON.parse(payload));
    if (!parsed.success) return [];
    return parsed.data.roles.map((role) => ({
      title: role.title,
      reason: role.reason,
      evidenceRefs: role.evidenceRefs,
    }));
  } catch {
    return [];
  }
}

/**
 * Называние ролей через Gemini.
 *
 * Решение владельца 2026-09-03: голова очереди называния — `gemini-3.6-flash`.
 * Замер на настоящих фактах кандидата назвал причину прямо: бесплатная голова
 * очереди коуча тратит 59 секунд, Gemini — 14.7 (B185), а потолок ступени стоит
 * на пятидесяти (B197). Это единственный порядок, при котором потолок не
 * приходится ни обходить, ни оплачивать.
 *
 * Транспорт свой: Gemini не говорит на `chat/completions`. Тоннель Cloudflare
 * обязателен по тому же решению владельца 2026-09-02, что и у хода коуча —
 * прямой вызов с прод-хоста не доходит.
 */
export interface GeminiRoleNamerOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  /** Vertex: `Authorization` с токеном сервисного аккаунта вместо ключа AI Studio. */
  authHeaders?: () => Promise<Record<string, string>>;
  /** Gemini 3 без ограничения тратит весь вывод на рассуждение (замер 25.09). */
  thinkingLevel?: 'low' | 'high';
  /** Vertex: повторы после 429 (нехватка общей мощности). */
  retriesOn429?: number;
  retryDelayMs?: number;
  /** Имя ступени в очереди — оно же уходит в провенанс ответа. */
  stage?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GeminiRoleNamer implements RoleNamer {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiRoleNamerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private send(facts: readonly CandidateFact[], language: RoleNameLanguage): Promise<Response> {
    const url = `${this.options.baseUrl.replace(/\/+$/u, '')}/models/${encodeURIComponent(
      this.options.model,
    )}:generateContent`;
    return retryOn429(
      async () =>
        this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.options.apiKey ? { 'x-goog-api-key': this.options.apiKey } : {}),
            ...(this.options.extraHeaders ?? {}),
            ...((await this.options.authHeaders?.()) ?? {}),
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: roleNamingInstructions(language) }] },
            contents: [{ role: 'user', parts: [{ text: serializeFacts(facts) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              // Gemini отвергает ограничения длины и размера (B183); годность
              // ответа всё равно решает zod.
              responseJsonSchema: geminiResponseSchema(ROLE_NAMING_JSON_SCHEMA.schema),
              ...(this.options.thinkingLevel
                ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel } }
                : {}),
            },
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS),
        }),
      this.options.retriesOn429 ?? 0,
      this.options.retryDelayMs,
    );
  }

  async nameRoles(
    facts: readonly CandidateFact[],
    language: RoleNameLanguage,
  ): Promise<RoleNamingOutcome> {
    if (facts.length === 0) return { roles: [] };
    const stage = this.options.stage ?? this.options.model;
    try {
      const response = await this.send(facts, language);
      if (!response.ok) {
        return { roles: [], failures: [await refusal(response, stage, this.options.apiKey)] };
      }
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return named(
        parseRoles(
          body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? null,
        ),
        stage,
      );
    } catch (error) {
      // Тот же уговор, что и у остальных ступеней: молчание не роняет панель,
      // но причина уходит в лог сервера.
      return { roles: [], failures: [thrownFailure(stage, error, this.options.apiKey)] };
    }
  }
}

/**
 * Код ответа и текст отказа — единственное, чем исчерпанная квота отличается
 * от отказа шлюза и отвергнутой схемы (INC-035).
 */
async function refusal(
  response: Response,
  stage: string,
  apiKey: string,
): Promise<RoleNamingStageFailure> {
  const detail = failureDetail(await response.text().catch(() => ''), apiKey);
  return { stage, kind: 'http_error', status: response.status, ...(detail ? { detail } : {}) };
}

export interface RoleNamingCacheEntry {
  /** Когда роли были названы, в миллисекундах эпохи. */
  readonly at: number;
  readonly roles: NamedRole[];
  readonly stage?: string;
}

/** Хранилище названных ролей между рестартами (B191). */
export interface RoleNamingCacheStore {
  read(key: string): RoleNamingCacheEntry | undefined;
  write(key: string, entry: RoleNamingCacheEntry): void;
}

/** Сколько живёт названное в базе: ключ меняется вместе с фактами. */
const DURABLE_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Кэш поверх называния ролей.
 *
 * Панель «Главной» читает маршрут при каждом входе, а вызов модели по замеру
 * B185 стоит от десяти до сорока секунд. Пока факты кандидата не изменились,
 * ответ тот же — спрашивать модель повторно значит платить временем кандидата
 * за уже известное.
 *
 * Ключ — хэш фактов, а не сами факты: класть в ключи формулировки о человеке
 * незачем. Память — быстрый слой, переживает рестарт база: без неё каждый
 * деплой снова звал модель и упирался в исчерпанную квоту (INC-035, B191).
 */
export class CachedRoleNamer implements RoleNamer {
  private readonly entries = new Map<string, { at: number; outcome: RoleNamingOutcome }>();

  private readonly ttlMs: number;
  private readonly now: () => number;
  /**
   * Хранилище переживает рестарт. Без него кэш терялся при каждом деплое, и
   * первый вход снова звал модель — в исчерпанную квоту (INC-035).
   */
  private readonly store: RoleNamingCacheStore | undefined;
  private readonly durableTtlMs: number;

  constructor(
    readonly inner: RoleNamer,
    options: {
      readonly ttlMs?: number;
      readonly now?: () => number;
      readonly store?: RoleNamingCacheStore;
      readonly durableTtlMs?: number;
    } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
    this.now = options.now ?? (() => Date.now());
    this.store = options.store;
    this.durableTtlMs = options.durableTtlMs ?? DURABLE_TTL_MS;
  }

  async nameRoles(
    facts: readonly CandidateFact[],
    language: RoleNameLanguage,
  ): Promise<RoleNamingOutcome> {
    // Язык — часть ключа: те же факты на другом языке дают другой ответ.
    const key = createHash('sha256')
      .update(`${language}\n${serializeFacts(facts)}`)
      .digest('hex');
    const cached = this.entries.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.outcome;

    const stored = this.store?.read(key);
    if (stored && this.now() - stored.at < this.durableTtlMs) {
      const outcome: RoleNamingOutcome = {
        roles: stored.roles,
        ...(stored.stage ? { stage: stored.stage } : {}),
      };
      this.entries.set(key, { at: this.now(), outcome });
      return outcome;
    }

    const outcome = await this.inner.nameRoles(facts, language);
    // Пустой ответ не кэшируется: отказ провайдера не должен становиться
    // «моделью названо ноль ролей» на четверть часа.
    // Причины в кэш не кладутся: попадание не должно писать в лог отказ,
    // случившийся четверть часа назад (INC-035).
    if (outcome.roles.length > 0) {
      const kept: RoleNamingOutcome = {
        roles: outcome.roles,
        ...(outcome.stage ? { stage: outcome.stage } : {}),
      };
      this.entries.set(key, { at: this.now(), outcome: kept });
      this.store?.write(key, {
        at: this.now(),
        roles: kept.roles,
        ...(kept.stage ? { stage: kept.stage } : {}),
      });
    }
    return outcome;
  }
}

/**
 * Очередь ступеней для называния ролей.
 *
 * Потолок ступени (30 секунд по решению владельца 2026-09-03, 50 после замера
 * B185 — см. B197) сам по себе роль не называет: живой замер по 32 фактам кандидата дал у бесплатной головы
 * очереди 59 секунд, из которых 2 373 токена ушли в рассуждение. Ступень с
 * потолком, за которой никого нет, превращает медленный ответ в пустую панель.
 * Поэтому называние ролей идёт той же очередью, что и ход коуча: молчание
 * ступени — повод спросить следующую.
 */
export class QueuedRoleNamer implements RoleNamer {
  constructor(
    private readonly stages: readonly RoleNamer[],
    readonly descriptors: readonly string[] = [],
  ) {}

  async nameRoles(
    facts: readonly CandidateFact[],
    language: RoleNameLanguage,
  ): Promise<RoleNamingOutcome> {
    const failures: RoleNamingStageFailure[] = [];
    for (const stage of this.stages) {
      const outcome = await stage.nameRoles(facts, language);
      failures.push(...(outcome.failures ?? []));
      // Причины промолчавших ступеней уходят вместе с ответом ответившей:
      // иначе сдвиг очереди виден только по времени ответа (INC-035).
      if (outcome.roles.length > 0) {
        return failures.length > 0 ? { ...outcome, failures } : outcome;
      }
    }
    return failures.length > 0 ? { roles: [], failures } : { roles: [] };
  }
}

/** Отчёт об очереди считается по ней самой, а не по отдельному списку (B183). */
export function describeRoleNamerQueue(namer: RoleNamer | undefined): string[] {
  const cached = namer instanceof CachedRoleNamer ? namer.inner : namer;
  // Между хранилищем и очередью стоит чистка названий (B210): она ступеней не
  // добавляет, поэтому обёртку разворачиваем, а не считаем концом очереди.
  const queue = cached instanceof HygienicRoleNamer ? cached.inner : cached;
  if (!(queue instanceof QueuedRoleNamer)) return [];
  return [...queue.descriptors];
}

export interface RoleNamerConfig {
  readonly personalProvider?: ProviderId;
  readonly model?: string;
  readonly fallbacks?: readonly ProviderQueueEntry[];
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  /** Без тоннеля ступень Gemini не строится вовсе — как и у хода коуча. */
  readonly cloudflareGateway?: CloudflareGatewayConfig;
  /** Gemini на Vertex — голова очереди называния, когда настроен (решение владельца 25.09). */
  readonly vertex?: VertexConfig;
  /** Хранилище названных ролей: без него кэш теряется при каждом деплое (B191). */
  readonly cacheStore?: RoleNamingCacheStore;
}

/**
 * Называние ролей говорит на `chat/completions`. Ступень с другим транспортом
 * (Gemini, Anthropic, Cohere, Yandex) пропускается: звать её этим клиентом
 * значило бы получить отказ и выдать его за молчание модели.
 */
function speaksChatCompletions(provider: ProviderId): boolean {
  return provider === 'openai' || modelRegistry[provider].transport === 'openai-compatible-chat';
}

/**
 * Порядок ступеней называния — не порядок очереди коуча.
 *
 * Решение владельца 2026-09-03: голова называния — Gemini (14.7 с против 59 с
 * у бесплатной головы коуча на настоящих фактах кандидата). Остальные ступени
 * сохраняют свой порядок и остаются запасом.
 */
function roleNamingOrder<T extends { provider: ProviderId }>(routes: readonly T[]): T[] {
  return [
    ...routes.filter((route) => route.provider === 'gemini'),
    ...routes.filter((route) => route.provider !== 'gemini'),
  ];
}

export function buildRoleNamer(config: RoleNamerConfig): RoleNamer | undefined {
  const provider: ProviderId = config.personalProvider ?? 'openai';
  const stages = roleNamingOrder(
    selectProviderQueue({
      head: { provider, ...(config.model ? { model: config.model } : {}) },
      fallbacks: config.fallbacks,
      credentials: config.providerCredentials ?? {},
    }).filter(
      (route) =>
        speaksChatCompletions(route.provider) ||
        // Gemini говорит своим транспортом и только через тоннель. Без тоннеля
        // ступень пропускается: прямой вызов с прод-хоста не доходит (B183).
        (route.provider === 'gemini' && config.cloudflareGateway !== undefined),
    ),
  );
  const vertexStages = config.vertex ? [vertexRoleNamer(config.vertex)] : [];
  if (stages.length === 0 && vertexStages.length === 0) return undefined;

  const gateway = config.cloudflareGateway;
  return new CachedRoleNamer(
    // Чистка стоит до хранилища: невидимая метка в названии роли не должна
    // пережить рестарт вместе с ним (B210, B191).
    new HygienicRoleNamer({
      inner: new QueuedRoleNamer(
        [...vertexStages, ...stages.map((route) => routeRoleNamer(route, gateway))],
        [
          ...(config.vertex ? [`vertex:${config.vertex.model}`] : []),
          ...stages.map((route) => `${route.provider}:${route.model}`),
        ],
      ),
    }),
    { ...(config.cacheStore ? { store: config.cacheStore } : {}) },
  );
}

function vertexRoleNamer(vertex: VertexConfig): RoleNamer {
  const tokens = new VertexTokenProvider(vertex);
  return new GeminiRoleNamer({
    apiKey: '',
    model: vertex.model,
    stage: `vertex:${vertex.model}`,
    baseUrl: vertexPublisherBaseUrl(vertex),
    authHeaders: async () => ({ Authorization: `Bearer ${await tokens.token()}` }),
    thinkingLevel: 'low',
    retriesOn429: 2,
  });
}

/** Ступень называния по маршруту очереди: Gemini — через тоннель, остальные — chat-completions. */
function routeRoleNamer(
  route: ProviderRoute,
  gateway: CloudflareGatewayConfig | undefined,
): RoleNamer {
  return route.provider === 'gemini' && gateway
    ? new GeminiRoleNamer({
        apiKey: route.apiKey,
        model: route.model,
        stage: `${route.provider}:${route.model}`,
        baseUrl: geminiGatewayBaseUrl(gateway),
        extraHeaders: cloudflareGatewayHeaders(gateway),
      })
    : new LlmRoleNamer({
        apiKey: route.apiKey,
        model: route.model,
        stage: `${route.provider}:${route.model}`,
        baseUrl: route.provider === 'openai' ? undefined : modelRegistry[route.provider].baseUrl,
        structuredOutput:
          modelRegistry[route.provider].models.find((item) => item.id === route.model)
            ?.structuredOutput ?? false,
        // Условие имеет смысл только у пула: у названной модели OpenRouter
        // отвечает `404 No endpoints found` (живая проверка 2026-09-03).
        requireParameters: route.provider === 'openrouter' && isMutableModelAlias(route.model),
      });
}
