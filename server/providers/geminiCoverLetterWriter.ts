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

export interface GeminiCoverLetterWriterOptions {
  readonly apiKey: string;
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
      const response = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.options.apiKey,
          ...(this.options.extraHeaders ?? {}),
        },
        body: JSON.stringify(requestBody(input)),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS),
      });
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

  private endpoint(): string {
    const base = this.options.baseUrl.replace(/\/+$/u, '');
    return `${base}/models/${encodeURIComponent(this.options.model)}:generateContent`;
  }
}

function requestBody(input: CoverLetterWriteInput) {
  return {
    systemInstruction: { parts: [{ text: coverLetterInstructions(input.language, input.tone) }] },
    contents: [{ role: 'user', parts: [{ text: serializeInput(input) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: geminiResponseSchema(COVER_LETTER_JSON_SCHEMA.schema),
      maxOutputTokens: COVER_LETTER_REASONING_TOKENS,
    },
  };
}
