import {
  FootprintSourceError,
  type FootprintAdapter,
  type FootprintFinding,
} from './footprintAdapter';
import { FootprintRequestGate, sharedFootprintRequestGate } from './requestScheduler';

/**
 * B668: канал YouTube по ссылке, которую кандидат дал сам. Один вызов
 * `channels.list` (1 единица квоты) с `part=id`: подтверждаем только, что канал
 * существует. Из ответа API ничего не сохраняем — ни id, ни названия: находка
 * несёт ссылку и подпись из ввода кандидата, поэтому хранить и обновлять раз
 * в 30 дней нечего (YouTube Developer Policies III.E.4). Ключ — в заголовке.
 */
const CHANNELS_API = 'https://www.googleapis.com/youtube/v3/channels';
const SOURCE_NAME = 'YouTube Data API';
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const NAME = /^[A-Za-z0-9._-]{1,100}$/u;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/u;

export interface YoutubeAdapterInput {
  readonly profileUrl: string;
}

export interface YoutubeAdapterOptions {
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly requestGate?: FootprintRequestGate;
}

export type YoutubeChannelQuery =
  | { readonly forHandle: string }
  | { readonly id: string }
  | { readonly forUsername: string };

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isYoutubeUrl(raw: string): boolean {
  const url = parse(raw);
  return Boolean(url && /^https?:$/u.test(url.protocol) && YOUTUBE_HOSTS.has(url.hostname.toLowerCase()));
}

/** `/@name` и `/c/name` → handle; `/channel/UC…` → id; `/user/name` → прежнее имя. */
export function youtubeChannelQuery(raw: string): YoutubeChannelQuery | null {
  if (!isYoutubeUrl(raw)) return null;
  const parts = parse(raw)!.pathname.split('/').filter(Boolean);
  const [first, second] = parts.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return '';
    }
  });
  if (first?.startsWith('@')) {
    const handle = first.slice(1);
    return NAME.test(handle) ? { forHandle: `@${handle}` } : null;
  }
  if (first === 'channel' && second && CHANNEL_ID.test(second)) return { id: second };
  if (first === 'user' && second && NAME.test(second)) return { forUsername: second };
  if (first === 'c' && second && NAME.test(second)) return { forHandle: `@${second}` };
  return null;
}

function queryText(query: YoutubeChannelQuery): string {
  const [name, value] = Object.entries(query)[0] as [string, string];
  return `${name}=${value}`;
}

/** Запрос канала, как он записан в квитанции находки; не канал — `null`. */
export function youtubeChannelQueryText(raw: string): string | null {
  const query = youtubeChannelQuery(raw);
  return query ? queryText(query) : null;
}

function sourceError(message: string): FootprintSourceError {
  return new FootprintSourceError('youtube', 'source_error', message);
}

async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw sourceError('Ответ YouTube слишком большой.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await readText(response);
  try {
    return JSON.parse(text);
  } catch {
    throw sourceError('Ответ YouTube имеет неподдерживаемый формат.');
  }
}

function channelFound(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') throw sourceError('Ответ YouTube пуст.');
  const items = (payload as { items?: unknown }).items;
  if (items === undefined) return false;
  if (!Array.isArray(items)) throw sourceError('Ответ YouTube имеет неподдерживаемый формат.');
  const id = (items[0] as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' && CHANNEL_ID.test(id);
}

function channelTitle(query: YoutubeChannelQuery): string {
  if ('forHandle' in query) return `Канал YouTube ${query.forHandle}`;
  if ('forUsername' in query) return `Канал YouTube ${query.forUsername}`;
  return 'Канал YouTube';
}

async function requestChannel(
  query: YoutubeChannelQuery,
  apiKey: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  requestGate: FootprintRequestGate,
): Promise<Response> {
  const url = new URL(CHANNELS_API);
  url.searchParams.set('part', 'id');
  url.searchParams.set('fields', 'items(id)');
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return requestGate.run('www.googleapis.com', signal, async () => {
    try {
      return await fetcher(url, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw sourceError('Не удалось связаться с YouTube.');
    }
  });
}

export function createYoutubeAdapter(
  options: YoutubeAdapterOptions,
): FootprintAdapter<YoutubeAdapterInput> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const requestGate = options.requestGate ?? sharedFootprintRequestGate;
  return {
    id: 'youtube',
    passive: true,
    async run(input, signal): Promise<readonly FootprintFinding[]> {
      if (!options.apiKey) {
        throw new FootprintSourceError('youtube', 'not_connected', 'Источник YouTube не подключён.');
      }
      if (signal.aborted) throw signal.reason;
      const query = youtubeChannelQuery(input.profileUrl);
      if (!query) return [];
      const response = await requestChannel(query, options.apiKey, signal, fetcher, requestGate);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw sourceError('Источник YouTube не ответил успешно.');
      }
      if (!channelFound(await readJson(response))) return [];
      return [
        {
          adapter: 'youtube',
          kind: 'profile',
          url: input.profileUrl,
          title: channelTitle(query),
          detail: 'Канал по вашей ссылке существует.',
          match: 'likely_self',
          observedAt: now().toISOString(),
          receipt: { method: 'GET', source: SOURCE_NAME, query: queryText(query) },
        },
      ];
    },
  };
}
