import { describe, expect, it, vi } from 'vitest';
import {
  TranscriberUnavailableError,
  WhisperHttpError,
  createWhisperTranscriber,
} from './whisperTranscriber';

const signal = new AbortController().signal;

describe('createWhisperTranscriber', () => {
  it('шлёт аудио в OpenRouter без хранения и разбирает отрезки', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            text: 'a b',
            segments: [
              { id: 0, start: 1.5, end: 2, text: ' привет ' },
              { start: 3, end: 4, text: ' ' },
            ],
          }),
          { status: 200 },
        ),
    );
    const run = createWhisperTranscriber({ openRouterKey: 'k' }, fetchImpl as never);
    const result = await run(Buffer.from('xyz'), signal);
    expect(result).toEqual([{ start: 1.5, end: 2, text: 'привет' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'openai/whisper-large-v3',
      input_audio: { data: Buffer.from('xyz').toString('base64'), format: 'm4a' },
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      provider: { zdr: true, data_collection: 'deny' },
    });
  });

  it('не-2xx: ошибка только с кодом, без тела', async () => {
    const run = createWhisperTranscriber(
      { openRouterKey: 'k' },
      (async () => new Response('SECRET-BODY', { status: 502 })) as never,
    );
    const error = await run(Buffer.from('x'), signal).catch((e: Error) => e);
    expect(error).toBeInstanceOf(WhisperHttpError);
    expect((error as Error).message).toBe('whisper_http_502');
  });

  it('без ключа — transcriber_unavailable, сеть не трогается', async () => {
    const fetchImpl = vi.fn();
    const run = createWhisperTranscriber({}, fetchImpl as never);
    await expect(run(Buffer.from('x'), signal)).rejects.toBeInstanceOf(TranscriberUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
