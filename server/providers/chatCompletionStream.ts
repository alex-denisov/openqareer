import type OpenAI from 'openai';
import { CoachProviderError } from './coachProvider';
import { partialJsonMessage } from './partialJsonMessage';

/** What a provider needs from a chat completion, streamed or not. */
export interface CollectedCompletion {
  readonly id: string;
  readonly model: string;
  readonly content: string | null | undefined;
  readonly usage: (OpenAI.Completions.CompletionUsage & { cost?: number }) | undefined;
}

type StreamChunk = OpenAI.Chat.Completions.ChatCompletionChunk & {
  usage?: CollectedCompletion['usage'] | null;
};

/**
 * Streams a chat completion and reports the JSON `message` as it grows (29.10).
 *
 * The SDK timeout stops at the response headers: a stream that stalls after
 * them would hang until the turn deadline. The stage keeps its own ceiling for
 * the whole body, so a stalled stage still yields to the next one in time.
 */
export async function streamChatCompletion(
  client: OpenAI,
  request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options: {
    readonly idempotencyKey: string;
    readonly timeoutMs: number;
    readonly onMessageText: (text: string) => void;
  },
): Promise<CollectedCompletion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let id = '';
  let model = request.model;
  let content = '';
  let message: string | undefined;
  let usage: CollectedCompletion['usage'];
  try {
    const stream = await client.chat.completions.create(
      { ...request, stream: true, stream_options: { include_usage: true } },
      { idempotencyKey: options.idempotencyKey, signal: controller.signal },
    );
    for await (const chunk of stream as AsyncIterable<StreamChunk>) {
      id ||= chunk.id;
      model = chunk.model || model;
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;
      content += delta;
      const next = partialJsonMessage(content);
      if (next !== undefined && next !== message) {
        message = next;
        options.onMessageText(next);
      }
    }
    // The SDK ends an aborted stream quietly instead of throwing: the ceiling is checked here too.
    if (controller.signal.aborted) throw stageTimeout();
  } catch (error) {
    if (controller.signal.aborted) throw stageTimeout();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return { id, model, content, usage };
}

export function collectedCompletion(
  response: OpenAI.Chat.Completions.ChatCompletion,
): CollectedCompletion {
  return {
    id: response.id,
    model: response.model,
    content: response.choices[0]?.message.content,
    usage: response.usage,
  };
}

function stageTimeout(): CoachProviderError {
  return new CoachProviderError('provider_timeout', 504, true);
}
