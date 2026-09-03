import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import {
  ROLE_NAMING_INSTRUCTIONS,
  ROLE_NAMING_JSON_SCHEMA,
  roleNamingSchema,
} from '../domain/roleNaming';
import type { NamedRole } from '../../shared/roleProposals';
import { modelRegistry, type ProviderId } from './modelRegistry';

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

  constructor(options: LlmRoleNamerOptions) {
    this.model = options.model;
    this.structuredOutput = options.structuredOutput ?? false;
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        timeout: options.timeoutMs ?? 60_000,
        maxRetries: 1,
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
          ? { response_format: { type: 'json_schema', json_schema: ROLE_NAMING_JSON_SCHEMA } }
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
    private readonly inner: RoleNamer,
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

export interface RoleNamerConfig {
  readonly personalProvider?: ProviderId;
  readonly model?: string;
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
}

export function buildRoleNamer(config: RoleNamerConfig): RoleNamer | undefined {
  const provider: ProviderId = config.personalProvider ?? 'openai';
  const apiKey = config.providerCredentials?.[provider];
  if (!apiKey) return undefined;
  const definition = modelRegistry[provider];
  const model = config.model ?? definition.models[0]?.id;
  if (!model) return undefined;
  return new CachedRoleNamer(
    new LlmRoleNamer({
      apiKey,
      model,
      baseUrl: provider === 'openai' ? undefined : definition.baseUrl,
      structuredOutput:
        definition.models.find((item) => item.id === model)?.structuredOutput ?? false,
    }),
  );
}
