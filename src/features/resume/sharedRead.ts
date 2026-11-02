/**
 * Callers that ask for the same read at the same time get one request (CPO prod,
 * 02.11: one Profile open sent /resume four times). A finished read is not reused,
 * so the next open reads fresh; `forget` drops a read that a write made stale.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const current = inFlight.get(key) as Promise<T> | undefined;
  if (current) return current;
  const next = read().finally(() => {
    if (inFlight.get(key) === next) inFlight.delete(key);
  });
  inFlight.set(key, next);
  return next;
}

export function forgetSharedRead(key: string): void {
  inFlight.delete(key);
}

/** A caller that aborts stops waiting; the shared read goes on for the others. */
export function untilAborted<T>(read: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    read.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
