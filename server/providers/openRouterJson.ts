import { modelRegistry } from './modelRegistry';
import type { ProviderRoute } from './providerQueue';

/** Запрос JSON у ступени цепочки, говорящей на chat-completions (OpenRouter, OpenAI). */
export interface ChatJsonRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Один вызов без повторов: отказ ступени — повод спросить следующую ступень
 * цепочки, а не ждать эту. Ответ — разобранный JSON или исключение.
 */
export async function requestChatJson(
  route: ProviderRoute,
  request: ChatJsonRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const baseUrl =
    route.provider === 'openai' ? OPENAI_BASE_URL : modelRegistry[route.provider].baseUrl;
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${route.apiKey}` },
    body: JSON.stringify({
      model: route.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_object' },
      ...(route.provider === 'openai'
        ? { max_completion_tokens: request.maxTokens }
        : { max_tokens: request.maxTokens, reasoning: { enabled: false } }),
    }),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${route.provider} status ${response.status}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${route.provider} returned no content`);
  return JSON.parse(stripJsonFence(content));
}

function stripJsonFence(content: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(content);
  return (fenced?.[1] ?? content).trim();
}
