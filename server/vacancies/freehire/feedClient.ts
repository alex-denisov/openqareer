import { withRequestTimeout } from '../requestTimeout';

/**
 * HTTP-клиент лент, перенесённых из freehire (B641).
 *
 * Перенос поведения `internal/ingest/sources/http.go`, `hostbackoff.go` и
 * `proxyretry.go` проекта github.com/strelov1/freehire (MIT, © 2026 freehire
 * contributors). Взято три правила:
 *
 * - повтор только того, что может пройти со второго раза: таймаут, обрыв,
 *   5xx; на 4xx площадка уже ответила, и повтор её только злит;
 * - `429`/`503` с `Retry-After` останавливает весь хост, а не один запрос:
 *   следующие страницы той же ленты ждут, сколько просили (hostbackoff);
 * - между страницами одной ленты пауза: хост не видит очередь запросов.
 */
export type FeedFetch = typeof fetch;

export interface FeedClientOptions {
  readonly fetchImpl?: FeedFetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly retries?: number;
}

export interface FeedClient {
  getJson(url: string, init?: FeedRequestInit): Promise<unknown>;
  getText(url: string, init?: FeedRequestInit): Promise<string>;
  /** Пауза между страницами одной ленты. */
  pause(ms: number): Promise<void>;
}

export interface FeedRequestInit {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_MS = 1_500;
/** Дольше ждать хост не имеет смысла: опрос лучше упадёт и придёт по расписанию. */
const MAX_HOST_BACKOFF_MS = 120_000;

export const FEED_USER_AGENT =
  'Mozilla/5.0 (compatible; openqareer/1.0; +https://openqareer.com)';

/** Хосты, попросившие паузу: общие для всех лент процесса. */
const hostPausedUntil = new Map<string, number>();

export function resetFeedHostBackoff(): void {
  hostPausedUntil.clear();
}

export class FeedHttpError extends Error {
  readonly statusCode: number;
  readonly headers?: Headers;
  constructor(status: number, url: string, headers?: Headers) {
    super(`vacancy_source_unreachable: ${status} ${new URL(url).host}`);
    this.statusCode = status;
    this.headers = headers;
  }
}

function retryAfterMs(headers: Headers | undefined, now: number): number | undefined {
  const raw = headers?.get('retry-after')?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof FeedHttpError) return err.statusCode >= 500 || err.statusCode === 429;
  return err instanceof Error; // таймаут, обрыв соединения, TLS
}

export function createFeedClient(options: FeedClientOptions = {}): FeedClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  async function waitForHost(host: string): Promise<void> {
    const until = hostPausedUntil.get(host);
    if (until === undefined) return;
    const wait = until - now();
    if (wait > 0) await sleep(Math.min(wait, MAX_HOST_BACKOFF_MS));
    hostPausedUntil.delete(host);
  }

  async function once(url: string, init: FeedRequestInit, accept: string): Promise<Response> {
    const host = new URL(url).host;
    await waitForHost(host);
    const res = await withRequestTimeout(timeoutMs, (signal) =>
      fetchImpl(url, {
        method: init.method ?? 'GET',
        signal,
        headers: {
          'User-Agent': FEED_USER_AGENT,
          Accept: accept,
          ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body ?? {}) } : {}),
      }),
    );
    if (res.status === 429 || res.status === 503) {
      const pause = retryAfterMs(res.headers, now()) ?? RETRY_BASE_MS * 4;
      hostPausedUntil.set(host, now() + Math.min(pause, MAX_HOST_BACKOFF_MS));
    }
    if (!res.ok) throw new FeedHttpError(res.status, url, res.headers);
    return res;
  }

  async function request(url: string, init: FeedRequestInit, accept: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      try {
        return await once(url, init, accept);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('vacancy_source_unreachable');
  }

  return {
    async getJson(url, init = {}) {
      const res = await request(url, init, 'application/json');
      const body = await res.text();
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new Error('vacancy_source_payload_unreadable');
      }
    },
    async getText(url, init = {}) {
      const res = await request(url, init, 'text/html,application/xhtml+xml,application/xml');
      return res.text();
    },
    pause: (ms) => sleep(ms),
  };
}
