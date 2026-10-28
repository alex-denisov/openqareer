import type { CampaignRoleModel, CampaignRoleModelInput } from '../vacancies/campaignRoleSet';
import { retryOn429, VertexTokenProvider, vertexPublisherBaseUrl, type VertexConfig } from './vertexAi';
import { MODEL_CHAINS, resolveChain } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';
import type { ProviderRoute } from './providerQueue';

const SYSTEM_PROMPT = `
Выбери 5–10 уникальных ролей кандидата: одну основную и остальные смежные.
Верни JSON-массив с полями id, level, kind (primary|adjacent), evidenceRefs и reason.
Выбирай id только из candidates. level — только ic, lead, head, vp или c-level.
Массив evidenceRefs у каждой роли должен быть непустым и ссылаться только на переданные facts.
`;

const RESPONSE_SCHEMA = {
  type: 'array', minItems: 5, maxItems: 10,
  items: {
    type: 'object', additionalProperties: false,
    required: ['id', 'level', 'kind', 'evidenceRefs', 'reason'],
    properties: {
      id: { type: 'string' },
      level: { type: 'string', enum: ['ic', 'lead', 'head', 'vp', 'c-level'] },
      kind: { type: 'string', enum: ['primary', 'adjacent'] },
      evidenceRefs: { type: 'array', minItems: 1, items: { type: 'string' } },
      reason: { type: 'string' },
    },
  },
} as const;

export class VertexCampaignRoleModel implements CampaignRoleModel {
  readonly name: string;
  private readonly tokens: VertexTokenProvider;

  constructor(
    private readonly config: VertexConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = config.model;
    this.tokens = new VertexTokenProvider(config, fetchImpl);
  }

  async propose(input: CampaignRoleModelInput): Promise<unknown> {
    const token = await this.tokens.token();
    const url = `${vertexPublisherBaseUrl(this.config)}/models/${encodeURIComponent(this.config.model)}:generateContent`;
    const response = await retryOn429(() => this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
      signal: AbortSignal.timeout(25_000),
    }), 2);
    if (!response.ok) throw new Error(`campaign role model failed with status ${response.status}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!text) throw new Error('campaign role model returned no JSON');
    return JSON.parse(text);
  }
}

const STAGE_TIMEOUT_MS = 25_000;
const CHAT_ANSWER_TOKENS = 4_096;

/** Ступень цепочки ролей кампании на chat-completions: тот же промпт, ответ — `{ roles: [...] }`. */
export class ChatCampaignRoleModel implements CampaignRoleModel {
  readonly name: string;

  constructor(
    private readonly route: ProviderRoute,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = route.model;
  }

  async propose(input: CampaignRoleModelInput): Promise<unknown> {
    const answer = await requestChatJson(
      this.route,
      {
        system: `${SYSTEM_PROMPT}\nОберни массив в JSON-объект: {"roles": [...]}.`,
        user: JSON.stringify(input),
        maxTokens: CHAT_ANSWER_TOKENS,
        timeoutMs: STAGE_TIMEOUT_MS,
      },
      this.fetchImpl,
    );
    return Array.isArray(answer) ? answer : (answer as { roles?: unknown } | null)?.roles;
  }
}

/** Ответ похож на набор ролей: окончательную проверку делает `campaignRoleSet`. */
function looksLikeRoleSet(answer: unknown): boolean {
  return Array.isArray(answer) && answer.length >= 5 && answer.length <= 10;
}

/**
 * Цепочка ролей кампании (28.10): сбой или негодный ответ ступени ведёт к
 * следующей. `name` называет ступень, ответившую последней.
 */
export class QueuedCampaignRoleModel implements CampaignRoleModel {
  private answered: CampaignRoleModel | undefined;

  constructor(readonly stages: readonly CampaignRoleModel[]) {}

  get name(): string | undefined {
    return (this.answered ?? this.stages[0])?.name;
  }

  async propose(input: CampaignRoleModelInput): Promise<unknown> {
    let lastError: unknown = new Error('campaign role chain is empty');
    for (const stage of this.stages) {
      try {
        const answer = await stage.propose(input);
        if (looksLikeRoleSet(answer)) {
          this.answered = stage;
          return answer;
        }
        lastError = new Error(`campaign role stage ${stage.name ?? 'model'} returned no role set`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

/** Цепочка ролей кампании (B580, 29.10): deepseek-v4-flash → glm-5.3-flash → Vertex. */
export function buildCampaignRoleModel(config: {
  providerCredentials?: Partial<Record<ProviderId, string>>;
  vertex?: VertexConfig;
}): CampaignRoleModel | undefined {
  const stages = resolveChain(
    MODEL_CHAINS.campaignRoles,
    config.providerCredentials ?? {},
    config.vertex,
  );
  if (stages.length === 0) return undefined;
  return new QueuedCampaignRoleModel(
    stages.map((stage) =>
      stage.kind === 'vertex'
        ? new VertexCampaignRoleModel(stage.vertex)
        : new ChatCampaignRoleModel(stage.route),
    ),
  );
}
