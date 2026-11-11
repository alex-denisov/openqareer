/**
 * B643-9: polite fetch — at most one request start per host per `gapMs`
 * (CPO 11.11: ≤1 request a second to a host), any number of hosts at once.
 */
interface Options {
  readonly gapMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const MAX_HOSTS = 5_000;

export function politeFetch(base: typeof fetch, options: Options = {}): typeof fetch {
  const gapMs = options.gapMs ?? 1_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  /** Host → time the next request may start; reserved before awaiting, so callers queue up. */
  const nextAt = new Map<string, number>();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    let host = '';
    try {
      host = new URL(input instanceof Request ? input.url : String(input)).host;
    } catch {
      return base(input, init);
    }
    const start = Math.max(now(), nextAt.get(host) ?? 0);
    if (nextAt.size > MAX_HOSTS) nextAt.clear();
    nextAt.set(host, start + gapMs);
    const delay = start - now();
    if (delay > 0) await sleep(delay);
    return base(input, init);
  }) as typeof fetch;
}
