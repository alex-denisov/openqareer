import type OpenAI from 'openai';
import { CoachProviderError } from './coachProvider';
import { partialJsonMessage } from './partialJsonMessage';

type ResponseEvent = OpenAI.Responses.ResponseStreamEvent;

/**
 * Streams a Responses API call and reports the JSON `message` as it grows
 * (29.10). Returns the final response with `output_text` filled in: the SDK
 * adds that field only to non-streamed calls. Like `streamChatCompletion`, the
 * stage keeps its own ceiling for the body — the SDK one ends at the headers.
 */
export async function streamResponse(
  client: OpenAI,
  request: OpenAI.Responses.ResponseCreateParamsNonStreaming,
  options: {
    readonly idempotencyKey: string;
    readonly timeoutMs: number;
    readonly onMessageText: (text: string) => void;
  },
): Promise<OpenAI.Responses.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let text = '';
  let message: string | undefined;
  try {
    const stream = await client.responses.create(
      { ...request, stream: true },
      { idempotencyKey: options.idempotencyKey, signal: controller.signal },
    );
    for await (const event of stream as AsyncIterable<ResponseEvent>) {
      if (event.type === 'response.output_text.delta') {
        text += event.delta;
        const next = partialJsonMessage(text);
        if (next !== undefined && next !== message) {
          message = next;
          options.onMessageText(next);
        }
      } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        return withOutputText(event.response);
      } else if (event.type === 'response.failed' || event.type === 'error') {
        throw new CoachProviderError('provider_unavailable', 503, true);
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
  // The stream ended without a final event: the answer cannot be trusted.
  throw new CoachProviderError('provider_unavailable', 503, true);
}

function withOutputText(response: OpenAI.Responses.Response): OpenAI.Responses.Response {
  const texts = (response.output ?? []).flatMap((item) =>
    item.type === 'message'
      ? item.content.flatMap((content) => (content.type === 'output_text' ? [content.text] : []))
      : [],
  );
  return { ...response, output_text: texts.join('') };
}

function stageTimeout(): CoachProviderError {
  return new CoachProviderError('provider_timeout', 504, true);
}
