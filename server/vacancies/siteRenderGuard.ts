import { isPublicHost } from '../connectors/publicHost';
import { createPinnedFetch, type PinnedFetch } from './pinnedFetch';
import { isTrackerHost } from './siteRenderBlocklist';

/**
 * B643: защита рендера от SSRF. Браузер сам в сеть не ходит: каждый запрос
 * страницы (переход, подресурс, каждый шаг редиректа) выполняет Node через
 * pinnedFetch, где проверка адреса и соединение идут по одному ответу DNS.
 * Адрес должен быть публичным http(s)-хостом на порту по умолчанию; ответ
 * 3xx проверяется по Location до передачи браузеру, следующий шаг снова
 * приходит сюда. WebSocket обходит page.route и закрывается отдельно.
 */

export interface GuardedRequest {
  url(): string;
  resourceType(): string;
  method(): string;
  headers(): Record<string, string>;
  postDataBuffer(): Buffer | null;
}

export interface GuardedRoute {
  request(): GuardedRequest;
  abort(): Promise<void>;
  fulfill(options: {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<void>;
}

/** Для списка вакансий не нужны: только тратят соединения и бюджет страницы. */
const BLOCKED_RESOURCES = new Set([
  'image',
  'font',
  'media',
  'stylesheet',
  'texttrack',
  'manifest',
  'eventsource',
]);

function isBlocked(request: GuardedRequest, url: string): boolean {
  if (BLOCKED_RESOURCES.has(request.resourceType()) || !isRenderableUrl(url)) return true;
  return isTrackerHost(new URL(url).hostname);
}

export interface RequestGuard {
  handle(route: GuardedRoute): Promise<void>;
}

function parse(url: string, base?: string): URL | undefined {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}

/** Синтаксическая проверка: http(s), DNS-имя, порт по умолчанию. DNS проверяет pinnedFetch при соединении. */
export function isRenderableUrl(url: string, base?: string): boolean {
  const parsed = parse(url, base);
  return parsed !== undefined && isPublicHost(parsed);
}

export function createRequestGuard(fetchPinned: PinnedFetch = createPinnedFetch()): RequestGuard {
  const handle = async (route: GuardedRoute): Promise<void> => {
    const request = route.request();
    const url = request.url();
    try {
      if (isBlocked(request, url)) {
        await route.abort();
        return;
      }
      const response = await fetchPinned({
        url,
        method: request.method(),
        headers: request.headers(),
        body: request.postDataBuffer(),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers['location'];
        if (!location || !isRenderableUrl(location, url)) {
          await route.abort();
          return;
        }
      }
      await route.fulfill(response);
    } catch {
      await route.abort().catch(() => undefined);
    }
  };
  return { handle };
}
