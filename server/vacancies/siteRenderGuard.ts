import { isPublicHost, resolvesPublic } from '../connectors/publicHost';

/**
 * B643: защита рендера от SSRF. Каждый запрос страницы (переход, подресурс,
 * каждый шаг редиректа) идёт только на публичный http(s)-хост на порту по
 * умолчанию, и все его адреса DNS публичные. Запрос выполняется без
 * редиректов: ответ 3xx проверяется по Location и только потом отдаётся
 * браузеру, а следующий шаг снова проходит через этот же обработчик.
 */

export interface GuardedResponse {
  status(): number;
  headers(): Record<string, string>;
}

export interface GuardedRoute {
  request(): { url(): string; resourceType(): string };
  abort(): Promise<void>;
  fetch(options: { maxRedirects: number }): Promise<GuardedResponse>;
  fulfill(options: { response: GuardedResponse }): Promise<void>;
}

export type HostIsPublic = (host: string) => Promise<boolean>;

const BLOCKED_RESOURCES = new Set(['image', 'font', 'media']);

export interface RequestGuard {
  isAllowed(url: string): Promise<boolean>;
  handle(route: GuardedRoute): Promise<void>;
}

function parse(url: string, base?: string): URL | undefined {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}

/** Ответы DNS кэшируются на время одного рендера: guard создаётся на страницу. */
export function createRequestGuard(
  hostIsPublic: HostIsPublic = (host) => resolvesPublic(host),
): RequestGuard {
  const verdicts = new Map<string, Promise<boolean>>();

  const isAllowed = async (url: string): Promise<boolean> => {
    const parsed = parse(url);
    if (!parsed || !isPublicHost(parsed)) return false;
    const host = parsed.hostname.toLowerCase();
    let verdict = verdicts.get(host);
    if (!verdict) {
      verdict = hostIsPublic(host).catch(() => false);
      verdicts.set(host, verdict);
    }
    return verdict;
  };

  const handle = async (route: GuardedRoute): Promise<void> => {
    const request = route.request();
    const url = request.url();
    try {
      if (BLOCKED_RESOURCES.has(request.resourceType()) || !(await isAllowed(url))) {
        await route.abort();
        return;
      }
      const response = await route.fetch({ maxRedirects: 0 });
      const status = response.status();
      if (status >= 300 && status < 400) {
        const location = response.headers()['location'];
        const next = location ? parse(location, url) : undefined;
        if (!next || !(await isAllowed(next.href))) {
          await route.abort();
          return;
        }
      }
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => undefined);
    }
  };

  return { isAllowed, handle };
}
