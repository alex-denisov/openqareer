import type { CampaignRoleModel, CampaignRoleModelInput } from '../vacancies/campaignRoleSet';
import { retryOn429, VertexTokenProvider, vertexPublisherBaseUrl, type VertexConfig } from './vertexAi';

const SYSTEM_PROMPT = `
Выбери одну основную и 3–8 смежных ролей кандидата.
Возверни JSON-массив. Каждый элемент: id, level, kind (primary|adjacent), evidenceRefs, reason.
id выбирай только из candidates. level — только ic, lead, head, vp или c-level.
evidenceRefs обязаны и должны ссылаться только на переданные facts.
`;

const RESPONSE_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 10,
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
