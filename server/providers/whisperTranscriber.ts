import type { ServerConfig } from '../config';

/** Один отрезок речи: время в секундах от начала сегмента. */
export interface WhisperSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type RecordingTranscriber = (
  audio: Buffer,
  signal: AbortSignal,
) => Promise<WhisperSegment[]>;

export const WHISPER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
export const WHISPER_MODEL = 'openai/whisper-large-v3';
/** Площадка отвечает за 60 с; запас на сеть. */
export const WHISPER_TIMEOUT_MS = 90_000;

export class TranscriberUnavailableError extends Error {
  constructor() {
    super('transcriber_unavailable');
    this.name = 'TranscriberUnavailableError';
  }
}

/** Ошибка площадки: только код ответа, без тела и аудио. */
export class WhisperHttpError extends Error {
  constructor(readonly status: number) {
    super(`whisper_http_${status}`);
    this.name = 'WhisperHttpError';
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parseWhisperResponse(body: unknown): WhisperSegment[] {
  const record = (body && typeof body === 'object' ? body : {}) as {
    text?: unknown;
    segments?: unknown;
  };
  const raw = Array.isArray(record.segments) ? record.segments : [];
  const parsed = raw.flatMap((item): WhisperSegment[] => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    return text ? [{ start: finiteNumber(row.start), end: finiteNumber(row.end), text }] : [];
  });
  if (parsed.length > 0) return parsed;
  const whole = typeof record.text === 'string' ? record.text.trim() : '';
  return whole ? [{ start: 0, end: 0, text: whole }] : [];
}

/** Whisper на OpenRouter: без хранения у площадки (zdr) и без сбора данных. */
export function createWhisperTranscriber(
  config: Pick<ServerConfig, 'openRouterKey'>,
  fetchImpl: typeof fetch = fetch,
): RecordingTranscriber {
  return async (audio, signal) => {
    if (!config.openRouterKey) throw new TranscriberUnavailableError();
    const response = await fetchImpl(WHISPER_URL, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${config.openRouterKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: WHISPER_MODEL,
        input_audio: { data: audio.toString('base64'), format: 'm4a' },
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
        provider: { zdr: true, data_collection: 'deny' },
      }),
    });
    if (!response.ok) throw new WhisperHttpError(response.status);
    return parseWhisperResponse(await response.json());
  };
}
