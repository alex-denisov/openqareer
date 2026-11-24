import { pinnedFetch } from '../outreach/dossier/pinnedFetch';
import { isTrackerUrl, parseHttpUrl, trackerHost } from '../domain/applyTarget/applyAddress';

/**
 * Переход трекера по действию кандидата (B787). Открываются только известные трекеры по https на
 * публичный адрес; конечная страница не запрашивается. Отказ площадки не повторяем и не обходим.
 */
const TIMEOUT_MS = 5_000;
const MAX_HOPS = 4;
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;
/** Обращений к одному трекеру в минуту со всего сервера: сверх — адрес остаётся нераскрытым. */
const HOST_LIMIT = 20;
const HOST_WINDOW_MS = 60_000;
const MAX_REMEMBERED = 2_000;

interface Remembered {
  readonly url: string | null;
  readonly until: number;
}

/** Трекер занят: попытки не было, запоминать нечего. */
class TrackerBusy extends Error {}

async function follow(
  start: string,
  fetchImpl: typeof fetch,
  admit: (url: string) => void,
): Promise<string | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    admit(current);
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

function createHostGate(now: () => number) {
  const starts = new Map<string, readonly number[]>();
  return (url: string): void => {
    const host = trackerHost(url) ?? '';
    const recent = (starts.get(host) ?? []).filter((at) => now() - at < HOST_WINDOW_MS);
    if (recent.length >= HOST_LIMIT) throw new TrackerBusy(host);
    starts.set(host, [...recent, now()]);
  };
}

function createMemory(now: () => number) {
  const remembered = new Map<string, Remembered>();

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

  return { known, remember };
}

export function createApplyRedirects(
  fetchImpl: typeof fetch = pinnedFetch,
  now: () => number = Date.now,
) {
  const { known, remember } = createMemory(now);
  const running = new Map<string, Promise<string | null>>();
  const admit = createHostGate(now);
  const byCandidate = new Map<
    string,
    { readonly url: string; readonly done: Promise<string | null> }
  >();

  async function read(url: string): Promise<string | null> {
    try {
      const found = await follow(url, fetchImpl, admit);
      remember(url, found);
      return found;
    } catch (reason) {
      // Сбой сети — «не узнали»: отклик остаётся на прежнем адресе.
      if (!(reason instanceof TrackerBusy)) remember(url, null);
      return null;
    }
  }

  function once(url: string): Promise<string | null> {
    const entry = known(url);
    if (entry) return Promise.resolve(entry.url);
    const started = running.get(url) ?? read(url).finally(() => running.delete(url));
    running.set(url, started);
    return started;
  }

  return {
    /** Уже известный конечный адрес; сети нет. */
    peek: (url: string): string | undefined => known(url)?.url ?? undefined,
    /**
     * Конечный адрес трекера: одна попытка, одновременные вызовы ждут её же. У кандидата идёт
     * один переход: следующая вакансия раскрывается после него.
     */
    async resolve(url: string, candidateId: string): Promise<string | null> {
      if (!isTrackerUrl(url)) return null;
      const entry = known(url);
      if (entry) return entry.url;
      const own = byCandidate.get(candidateId);
      if (own?.url === url) return own.done;
      const done = (own?.done ?? Promise.resolve(null)).then(() => once(url));
      const turn = { url, done };
      byCandidate.set(candidateId, turn);
      try {
        return await done;
      } finally {
        if (byCandidate.get(candidateId) === turn) byCandidate.delete(candidateId);
      }
    },
  };
}

export const applyRedirects = createApplyRedirects();
