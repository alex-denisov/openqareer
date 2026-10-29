import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { apiFetch } from './apiClient';

/** The server never streams longer than the client waits for a turn (240 s). */
const STREAM_WAIT_MS = 240_000;

interface SseEvent {
  readonly event: string;
  readonly data: string;
}

/**
 * 29.10 (owner): the consultant's reply while it is written. `onMessageText`
 * gets the whole text so far; an empty string means «start over» — the server
 * moved to the next model. Resolves with the stored result on `done`.
 *
 * `undefined` is never an error: the stream is only a preview, and the caller
 * reads `/result` as before. The desktop app reads responses whole through its
 * native bridge, so it does not stream.
 */
export async function streamCoachResult<T extends object>(
  key: string,
  onMessageText: (text: string) => void,
  signal?: AbortSignal,
): Promise<T | undefined> {
  if (isTauriEnvironment()) return undefined;
  try {
    const timeout = AbortSignal.timeout(STREAM_WAIT_MS);
    const response = await apiFetch(`/api/v1/coach/turn/${encodeURIComponent(key)}/stream`, {
      // The panel cancels a stream it no longer shows: it would hold one of the browser's connections.
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) return undefined;
    let text = '';
    for await (const event of readEvents(response.body)) {
      if (event.event === 'delta') {
        text += (JSON.parse(event.data) as { text: string }).text;
        onMessageText(text);
      } else if (event.event === 'reset') {
        text = '';
        onMessageText('');
      } else if (event.event === 'done') {
        const result: unknown = (JSON.parse(event.data) as { data?: unknown }).data;
        return result && typeof result === 'object' ? (result as T) : undefined;
      } else {
        return undefined;
      }
    }
  } catch {
    // A broken stream falls back to the stored result.
  }
  return undefined;
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function parseEvent(block: string): SseEvent | undefined {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return data.length ? { event, data: data.join('\n') } : undefined;
}
