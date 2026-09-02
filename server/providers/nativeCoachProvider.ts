import {
  COACH_TURN_JSON_SCHEMA,
  coachTurnResultSchema,
  serializeCoachInput,
  type CoachTurnInput,
} from '../domain/coach';
import { careerInstructionsForRole } from '../prompts/careerRolePrompts';
import {
  CoachProviderError,
  type CoachProvider,
  type CoachProviderResult,
} from './coachProvider';

export type NativeProviderId = 'anthropic' | 'gemini' | 'cohere' | 'yandex';

interface NativeCoachProviderOptions {
  provider: NativeProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  folderId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Заголовки тоннеля: аутентифицированный шлюз Cloudflare требует свой. */
  extraHeaders?: Record<string, string>;
}

interface NativeResponse {
  text: string;
  model: string;
  responseId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class NativeCoachProvider implements CoachProvider {
  private readonly options: NativeCoachProviderOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NativeCoachProviderOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<CoachProviderResult> {
    try {
      const response = await this.request(input, idempotencyKey);
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text);
      } catch {
        throw invalidOutput();
      }
      const result = coachTurnResultSchema.safeParse(parsed);
      if (!result.success) throw invalidOutput();
      return {
        result: result.data,
        provider: this.options.provider,
        model: response.model,
        responseId: response.responseId,
        usage: {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          totalTokens: response.totalTokens,
        },
      };
    } catch (error) {
      if (error instanceof CoachProviderError) throw error;
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new CoachProviderError('provider_timeout', 504, true);
      }
      throw new CoachProviderError('provider_unavailable', 503, true);
    }
  }

  private async request(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<NativeResponse> {
    const { provider } = this.options;
    if (provider === 'anthropic') {
      return this.requestAnthropic(input, idempotencyKey);
    }
    if (provider === 'gemini') {
      return this.requestGemini(input, idempotencyKey);
    }
    if (provider === 'cohere') {
      return this.requestCohere(input, idempotencyKey);
    }
    return this.requestYandex(input, idempotencyKey);
  }

  private async requestAnthropic(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<NativeResponse> {
    const payload = await this.postJson(
      `${trimSlash(this.options.baseUrl)}/messages`,
      {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
        'x-client-request-id': idempotencyKey,
      },
      {
        model: this.options.model,
        max_tokens: 2_400,
        system: careerInstructionsForRole(input.activeRole),
        messages: [{ role: 'user', content: serializeCoachInput(input) }],
      },
    );
    const body = payload as {
      id?: string;
      model?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    return {
      text: body.content?.map((item) => item.text ?? '').join('').trim() ?? '',
      model: body.model ?? this.options.model,
      responseId: body.id ?? idempotencyKey,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  private geminiHeaders(idempotencyKey: string): Record<string, string> {
    return {
      'x-goog-api-key': this.options.apiKey,
      'x-client-request-id': idempotencyKey,
      ...(this.options.extraHeaders ?? {}),
    };
  }

  private async requestGemini(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<NativeResponse> {
    const payload = await this.postJson(
      `${trimSlash(this.options.baseUrl)}/models/${encodeURIComponent(this.options.model)}:generateContent`,
      this.geminiHeaders(idempotencyKey),
      {
        systemInstruction: { parts: [{ text: careerInstructionsForRole(input.activeRole) }] },
        contents: [
          { role: 'user', parts: [{ text: serializeCoachInput(input) }] },
        ],
        generationConfig: {
          maxOutputTokens: 2_400,
          responseMimeType: 'application/json',
          responseJsonSchema: COACH_TURN_JSON_SCHEMA,
        },
      },
    );
    const body = payload as {
      responseId?: string;
      modelVersion?: string;
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text:
        body.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('')
          .trim() ?? '',
      model: body.modelVersion ?? this.options.model,
      responseId: body.responseId ?? idempotencyKey,
      inputTokens,
      outputTokens,
      totalTokens:
        body.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
    };
  }

  private async requestCohere(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<NativeResponse> {
    const payload = await this.postJson(
      `${trimSlash(this.options.baseUrl)}/v2/chat`,
      {
        Authorization: `Bearer ${this.options.apiKey}`,
        'x-client-request-id': idempotencyKey,
      },
      {
        model: this.options.model,
        messages: [
          { role: 'system', content: careerInstructionsForRole(input.activeRole) },
          { role: 'user', content: serializeCoachInput(input) },
        ],
        max_tokens: 2_400,
        response_format: { type: 'json_object' },
      },
    );
    const body = payload as {
      id?: string;
      message?: { content?: Array<{ type?: string; text?: string }> };
      usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
    };
    const inputTokens = body.usage?.tokens?.input_tokens ?? 0;
    const outputTokens = body.usage?.tokens?.output_tokens ?? 0;
    return {
      text:
        body.message?.content
          ?.map((part) => part.text ?? '')
          .join('')
          .trim() ?? '',
      model: this.options.model,
      responseId: body.id ?? idempotencyKey,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  private async requestYandex(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<NativeResponse> {
    if (!this.options.folderId) {
      throw new CoachProviderError('provider_unavailable', 503, false);
    }
    const payload = await this.postJson(
      `${trimSlash(this.options.baseUrl)}/completion`,
      {
        Authorization: `Api-Key ${this.options.apiKey}`,
        'x-client-request-id': idempotencyKey,
      },
      {
        modelUri: `gpt://${this.options.folderId}/${this.options.model}`,
        completionOptions: {
          stream: false,
          temperature: 0.1,
          maxTokens: '2400',
        },
        messages: [
          { role: 'system', text: careerInstructionsForRole(input.activeRole) },
          { role: 'user', text: serializeCoachInput(input) },
        ],
      },
    );
    const body = payload as {
      result?: {
        modelVersion?: string;
        alternatives?: Array<{ message?: { text?: string } }>;
        usage?: {
          inputTextTokens?: string | number;
          completionTokens?: string | number;
          totalTokens?: string | number;
        };
      };
    };
    const result = body.result ?? {};
    return {
      text: result.alternatives?.[0]?.message?.text?.trim() ?? '',
      model: result.modelVersion ?? this.options.model,
      responseId: idempotencyKey,
      inputTokens: numeric(result.usage?.inputTextTokens),
      outputTokens: numeric(result.usage?.completionTokens),
      totalTokens: numeric(result.usage?.totalTokens),
    };
  }

  private async postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 85_000),
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new CoachProviderError('provider_rate_limited', 429, true);
      }
      throw new CoachProviderError(
        'provider_unavailable',
        response.status >= 500 ? 503 : 502,
        response.status === 408 || response.status === 409,
      );
    }
    return response.json();
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function numeric(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function invalidOutput(): CoachProviderError {
  return new CoachProviderError('provider_output_invalid', 502, true);
}
