import { modelRegistry } from './modelRegistry';
import { openRouterRouting } from './openRouterPrivacy';
import { openRouterReasoning } from './openRouterReasoning';
import type { ProviderRoute } from './providerQueue';

/** Запрос JSON у ступени цепочки, говорящей на chat-completions (OpenRouter, OpenAI). */
export interface ChatJsonRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  /** Данные кандидата: OpenRouter не отдаёт их провайдерам, которые собирают данные. */
  readonly personal?: boolean;
  /** Картинки к сообщению пользователя (base64): только модели с входом изображения. */
  readonly images?: readonly { readonly mimeType: string; readonly data: string }[];
}

function userContent(request: ChatJsonRequest) {
  if (!request.images?.length) return request.user;
  return [
    { type: 'text', text: request.user },
    ...request.images.map((image) => ({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    })),
  ];
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
        { role: 'user', content: userContent(request) },
      ],
      response_format: { type: 'json_object' },
      ...(route.provider === 'openai'
        ? { max_completion_tokens: request.maxTokens }
        : {
            max_tokens: request.maxTokens,
            reasoning: openRouterReasoning(route.model),
            ...(route.provider === 'openrouter' && request.personal
              ? openRouterRouting({ personal: true })
              : {}),
          }),
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
