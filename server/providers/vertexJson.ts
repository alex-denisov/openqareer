import type { ChatCompletionClient } from './resumeStructurer';
import { VertexTokenProvider, vertexPublisherBaseUrl, type VertexConfig } from './vertexAi';

/** Reasoning shares the output cap with the answer (memory: reasoning effort needs output budget). */
export const VERTEX_THINKING_HEADROOM_TOKENS = 4_096;

export interface VertexJsonRequest {
  readonly system: string;
  readonly user: string;
  /** Room for the answer; the thinking headroom is added on top. */
  readonly answerTokens: number;
}

/**
 * One JSON-answer call to Gemini on Vertex. `fetchImpl` is the metered fetch of the mechanic
 * (`meteredVertexFetchFor`): the gate, the ledger and the stage ceiling all live there, so a refusal,
 * a closed gate or a timeout surface here as a thrown error and the chain moves on. No retry inside:
 * the next stage of the chain is the retry, a candidate is waiting.
 */
export class VertexJsonClient {
  private readonly tokens: VertexTokenProvider;

  constructor(
    private readonly vertex: VertexConfig,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.tokens = new VertexTokenProvider(vertex, fetchImpl);
  }

  get model(): string {
    return this.vertex.model;
  }

  async complete(request: VertexJsonRequest): Promise<string> {
    const token = await this.tokens.token();
    const response = await this.fetchImpl(
      `${vertexPublisherBaseUrl(this.vertex)}/models/${encodeURIComponent(this.vertex.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: request.answerTokens + VERTEX_THINKING_HEADROOM_TOKENS,
            thinkingConfig: { thinkingLevel: 'low' },
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`vertex answered ${response.status}`);
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (!text) throw new Error('vertex returned no text');
    return text;
  }

  /**
   * The slice of an OpenAI-compatible client that resume and bullet stages use, so those stages keep
   * their prompts, caps and answer checks unchanged and only the transport differs.
   */
  asChatClient(): ChatCompletionClient {
    return {
      chat: {
        completions: {
          create: async (request) => {
            const messages = request.messages as Array<{ role: string; content: string }>;
            const system = messages.find((item) => item.role === 'system')?.content ?? '';
            const user = messages.find((item) => item.role === 'user')?.content ?? '';
            const cap = Number(request.max_completion_tokens);
            const content = await this.complete({
              system,
              user,
              answerTokens: Number.isFinite(cap) && cap > 0 ? cap : 8_000,
            });
            return { choices: [{ message: { content } }] };
          },
        },
      },
    };
  }
}
