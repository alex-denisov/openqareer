import { COVER_LETTER_JSON_SCHEMA, coverLetterInstructions } from '../domain/coverLetterWriting';
import {
  acceptModelBody,
  COVER_LETTER_REASONING_TOKENS,
  failureDetail,
  serializeInput,
  thrownFailure,
  type CoverLetterOutcome,
  type CoverLetterWriteInput,
  type CoverLetterWriter,
} from './coverLetterWriter';
import { geminiResponseSchema } from './geminiSchema';
import { PROVIDER_STAGE_TIMEOUT_MS } from './stageTimeout';
import { retryOn429 } from './vertexAi';

export interface GeminiCoverLetterWriterOptions {
  /** Ключ AI Studio; у Vertex пусто — доступ даёт `authHeaders`. */
  readonly apiKey: string;
  /** Vertex: заголовок `Authorization` с токеном сервисного аккаунта. */
  readonly authHeaders?: () => Promise<Record<string, string>>;
  /** Gemini 3 по умолчанию тратит весь вывод на рассуждение (замер 25.09: «...»). */
  readonly thinkingLevel?: 'low' | 'high';
  /** Vertex отвечает 429 при нехватке общей мощности — один повтор помогает. */
  readonly retriesOn429?: number;
  readonly retryDelayMs?: number;
  readonly model: string;
  readonly baseUrl: string;
  readonly stage?: string;
  readonly extraHeaders?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/**
 * Ступень письма на Gemini (B266). Бесплатный nemotron писал письмо 30–105 с
 * при сроке 25 с (замер 25.09), поэтому голова очереди письма — та же, что у
 * называния ролей: Gemini через тоннель Cloudflare (решение владельца
 * 2026-09-03, Vertex-бонус — 2026-09-25). Приёмка ответа общая с остальными
 * ступенями (`acceptModelBody`).
 */
export class GeminiCoverLetterWriter implements CoverLetterWriter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiCoverLetterWriterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async writeCoverLetter(input: CoverLetterWriteInput): Promise<CoverLetterOutcome> {
    if (input.facts.length === 0) return {};
    const stage = this.options.stage ?? this.options.model;
    try {
      const response = await this.send(input, this.options.retriesOn429 ?? 0);
      if (!response.ok) {
        const detail = failureDetail(await response.text().catch(() => ''), this.options.apiKey);
        return {
          failure: {
            stage,
            kind: 'http_error',
            status: response.status,
            ...(detail ? { detail } : {}),
          },
        };
      }
      const candidate = ((await response.json()) as GeminiResponse).candidates?.[0];
      const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? null;
      return acceptModelBody(text, candidate?.finishReason === 'MAX_TOKENS', stage);
    } catch (error) {
      return { failure: thrownFailure(stage, error, this.options.apiKey) };
    }
  }

  private send(input: CoverLetterWriteInput, retries: number): Promise<Response> {
    return retryOn429(
      async () =>
        this.fetchImpl(this.endpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.options.apiKey ? { 'x-goog-api-key': this.options.apiKey } : {}),
            ...(this.options.extraHeaders ?? {}),
            ...((await this.options.authHeaders?.()) ?? {}),
          },
          body: JSON.stringify(requestBody(input, this.options.thinkingLevel)),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS),
        }),
      retries,
      this.options.retryDelayMs,
    );
  }

  private endpoint(): string {
    const base = this.options.baseUrl.replace(/\/+$/u, '');
    return `${base}/models/${encodeURIComponent(this.options.model)}:generateContent`;
  }
}

function requestBody(input: CoverLetterWriteInput, thinkingLevel?: 'low' | 'high') {
  return {
    systemInstruction: { parts: [{ text: coverLetterInstructions(input.language, input.tone) }] },
    contents: [{ role: 'user', parts: [{ text: serializeInput(input) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: geminiResponseSchema(COVER_LETTER_JSON_SCHEMA.schema),
      maxOutputTokens: COVER_LETTER_REASONING_TOKENS,
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    },
  };
}
