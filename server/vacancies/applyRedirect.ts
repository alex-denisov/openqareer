import { pinnedFetch } from '../outreach/dossier/pinnedFetch';
import { isTrackerUrl, parseHttpUrl } from '../domain/applyTarget/applyAddress';

/**
 * Переход трекера по действию кандидата (B787). Открываются только известные трекеры по https на
 * публичный адрес; конечная страница не запрашивается. Отказ площадки не повторяем и не обходим.
 */
const TIMEOUT_MS = 5_000;
const MAX_HOPS = 4;
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;
const MAX_REMEMBERED = 2_000;

interface Remembered {
  readonly url: string | null;
  readonly until: number;
}

async function follow(start: string, fetchImpl: typeof fetch): Promise<string | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const response = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal });
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (
      response.status < 300 ||
      response.status >= 400 ||
      !location ||
      !URL.canParse(location, current)
    )
      return null;
    current = new URL(location, current).href;
    if (!isTrackerUrl(current))
      return parseHttpUrl(current)?.protocol === 'https:' ? current : null;
  }
  return null;
}

export function createApplyRedirects(
  fetchImpl: typeof fetch = pinnedFetch,
  now: () => number = Date.now,
) {
  const remembered = new Map<string, Remembered>();
  const running = new Map<string, Promise<string | null>>();

  function known(url: string): Remembered | undefined {
    const entry = remembered.get(url);
    if (!entry || entry.until > now()) return entry;
    remembered.delete(url);
    return undefined;
  }

  function remember(url: string, found: string | null): void {
    const oldest = remembered.size >= MAX_REMEMBERED ? remembered.keys().next().value : undefined;
    if (oldest !== undefined) remembered.delete(oldest);
    remembered.set(url, { url: found, until: now() + (found ? FOUND_TTL_MS : FAILED_TTL_MS) });
  }

  async function read(url: string): Promise<string | null> {
    // Сбой сети — «не узнали»: отклик остаётся на прежнем адресе.
    const found = await follow(url, fetchImpl).catch(() => null);
    remember(url, found);
    return found;
  }

  return {
    /** Уже известный конечный адрес; сети нет. */
    peek: (url: string): string | undefined => known(url)?.url ?? undefined,
    /** Конечный адрес трекера: одна попытка, одновременные вызовы ждут её же. */
    async resolve(url: string): Promise<string | null> {
      if (!isTrackerUrl(url)) return null;
      const entry = known(url);
      if (entry) return entry.url;
      const started = running.get(url) ?? read(url).finally(() => running.delete(url));
      running.set(url, started);
      return started;
    },
  };
}

export const applyRedirects = createApplyRedirects();
