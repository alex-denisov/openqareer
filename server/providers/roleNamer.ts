import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import {
  ROLE_NAMING_INSTRUCTIONS,
  ROLE_NAMING_JSON_SCHEMA,
  roleNamingSchema,
} from '../domain/roleNaming';
import {
  cloudflareGatewayHeaders,
  geminiGatewayBaseUrl,
  type CloudflareGatewayConfig,
} from './cloudflareAiGateway';
import { geminiResponseSchema } from './geminiSchema';
import type { NamedRole } from '../../shared/roleProposals';
import {
  isMutableModelAlias,
  modelRegistry,
  type ProviderId,
} from './modelRegistry';
import {
  selectProviderQueue,
  type ProviderQueueEntry,
} from './providerQueue';
import {
  PROVIDER_STAGE_MAX_RETRIES,
  PROVIDER_STAGE_TIMEOUT_MS,
} from './stageTimeout';

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

export interface RoleNamer {
  /** Пустой список — законный ответ: он означает «модель не назвала». */
  nameRoles(facts: readonly CandidateFact[]): Promise<NamedRole[]>;
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
  private readonly model: string;
  private readonly structuredOutput: boolean;
  private readonly requireParameters: boolean;

  constructor(options: LlmRoleNamerOptions) {
    this.model = options.model;
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

  async nameRoles(facts: readonly CandidateFact[]): Promise<NamedRole[]> {
    // Спрашивать модель не о чем — это не отказ провайдера, а отсутствие входа.
    if (facts.length === 0) return [];
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: ROLE_NAMING_INSTRUCTIONS },
          { role: 'user', content: serializeFacts(facts) },
        ],
        // `json_object` у модели без структурированного вывода ломал вызов на
        // проде: OpenRouter отвечал телом без `choices`, и роль не называлась
        // вовсе. Формат просим только там, где он поддержан.
        ...(this.structuredOutput
          ? {
              response_format: { type: 'json_schema', json_schema: ROLE_NAMING_JSON_SCHEMA },
              ...(this.requireParameters
                ? { provider: { require_parameters: true } }
                : {}),
            }
          : {}),
      });
      return parseRoles(response.choices[0]?.message?.content ?? null);
    } catch {
      // Молчание провайдера не должно ронять панель: роль просто не названа.
      return [];
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
 * очереди коуча тратит 59 секунд, Gemini — 14.7 (B185), а потолок ступени
 * стоит на тридцати. Это единственный порядок, при котором потолок не
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
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GeminiRoleNamer implements RoleNamer {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiRoleNamerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async nameRoles(facts: readonly CandidateFact[]): Promise<NamedRole[]> {
    if (facts.length === 0) return [];
    try {
      const response = await this.fetchImpl(
        `${this.options.baseUrl.replace(/\/+$/u, '')}/models/${encodeURIComponent(
          this.options.model,
        )}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.options.apiKey,
            ...(this.options.extraHeaders ?? {}),
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: ROLE_NAMING_INSTRUCTIONS }] },
            contents: [{ role: 'user', parts: [{ text: serializeFacts(facts) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              // Gemini отвергает ограничения длины и размера (B183); годность
              // ответа всё равно решает zod.
              responseJsonSchema: geminiResponseSchema(ROLE_NAMING_JSON_SCHEMA.schema),
            },
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS),
        },
      );
      if (!response.ok) return [];
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return parseRoles(
        body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? null,
      );
    } catch {
      // Тот же уговор, что и у остальных ступеней: молчание не роняет панель.
      return [];
    }
  }
}

/**
 * Кэш поверх называния ролей.
 *
 * Панель «Главной» читает маршрут при каждом входе, а вызов модели по замеру
 * B185 стоит от десяти до сорока секунд. Пока факты кандидата не изменились,
 * ответ тот же — спрашивать модель повторно значит платить временем кандидата
 * за уже известное.
 *
 * Ключ — хэш фактов, а не сами факты: карта живёт в памяти процесса, и класть
 * в её ключи формулировки о человеке незачем. Значения теряются при рестарте, и
 * это осознанно: постоянное хранение названных ролей — отдельная работа
 * (нужна миграция хранилища), а не побочный эффект этого среза.
 */
export class CachedRoleNamer implements RoleNamer {
  private readonly entries = new Map<string, { at: number; roles: NamedRole[] }>();

  constructor(
    readonly inner: RoleNamer,
    private readonly ttlMs = 15 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async nameRoles(facts: readonly CandidateFact[]): Promise<NamedRole[]> {
    const key = createHash('sha256').update(serializeFacts(facts)).digest('hex');
    const cached = this.entries.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.roles;
    const roles = await this.inner.nameRoles(facts);
    // Пустой ответ не кэшируется: отказ провайдера не должен становиться
    // «моделью названо ноль ролей» на четверть часа.
    if (roles.length > 0) this.entries.set(key, { at: this.now(), roles });
    return roles;
  }
}

/**
 * Очередь ступеней для называния ролей.
 *
 * Потолок ступени в тридцать секунд (решение владельца 2026-09-03) сам по себе
 * роль не называет: живой замер по 32 фактам кандидата дал у бесплатной головы
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

  async nameRoles(facts: readonly CandidateFact[]): Promise<NamedRole[]> {
    for (const stage of this.stages) {
      const roles = await stage.nameRoles(facts);
      if (roles.length > 0) return roles;
    }
    return [];
  }
}

/** Отчёт об очереди считается по ней самой, а не по отдельному списку (B183). */
export function describeRoleNamerQueue(namer: RoleNamer | undefined): string[] {
  const queue = namer instanceof CachedRoleNamer ? namer.inner : namer;
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
}

/**
 * Называние ролей говорит на `chat/completions`. Ступень с другим транспортом
 * (Gemini, Anthropic, Cohere, Yandex) пропускается: звать её этим клиентом
 * значило бы получить отказ и выдать его за молчание модели.
 */
function speaksChatCompletions(provider: ProviderId): boolean {
  return (
    provider === 'openai' ||
    modelRegistry[provider].transport === 'openai-compatible-chat'
  );
}

/**
 * Порядок ступеней называния — не порядок очереди коуча.
 *
 * Решение владельца 2026-09-03: голова называния — Gemini (14.7 с против 59 с
 * у бесплатной головы коуча на настоящих фактах кандидата). Остальные ступени
 * сохраняют свой порядок и остаются запасом.
 */
function roleNamingOrder<T extends { provider: ProviderId }>(
  routes: readonly T[],
): T[] {
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
  if (stages.length === 0) return undefined;

  const gateway = config.cloudflareGateway;
  return new CachedRoleNamer(
    new QueuedRoleNamer(
      stages.map((route) =>
        route.provider === 'gemini' && gateway
          ? new GeminiRoleNamer({
              apiKey: route.apiKey,
              model: route.model,
              baseUrl: geminiGatewayBaseUrl(gateway),
              extraHeaders: cloudflareGatewayHeaders(gateway),
            })
          : new LlmRoleNamer({
              apiKey: route.apiKey,
              model: route.model,
              baseUrl:
                route.provider === 'openai'
                  ? undefined
                  : modelRegistry[route.provider].baseUrl,
              structuredOutput:
                modelRegistry[route.provider].models.find(
                  (item) => item.id === route.model,
                )?.structuredOutput ?? false,
              // Условие имеет смысл только у пула: у названной модели OpenRouter
              // отвечает `404 No endpoints found` (живая проверка 2026-09-03).
              requireParameters:
                route.provider === 'openrouter' && isMutableModelAlias(route.model),
            }),
      ),
      stages.map((route) => `${route.provider}:${route.model}`),
    ),
  );
}
