import { onApiWrite } from '../coach/apiClient';

/**
 * Callers that ask for the same read get one request (CPO prod, 02.11: one Profile open
 * sent /resume three or four times, seconds apart). A finished read is kept for `keepMs`;
 * any write through `apiFetch` drops every kept read, so a refresh after it reads fresh.
 */
const reads = new Map<string, { readonly promise: Promise<unknown>; settledAt?: number }>();

export function sharedRead<T>(
  key: string,
  read: () => Promise<T>,
  { keepMs = 0 }: { readonly keepMs?: number } = {},
): Promise<T> {
  const current = reads.get(key);
  const fresh =
    current && (current.settledAt === undefined || Date.now() - current.settledAt < keepMs);
  if (current && fresh) return current.promise as Promise<T>;
  const entry: { readonly promise: Promise<T>; settledAt?: number } = {
    promise: read().then(
      (value) => {
        entry.settledAt = Date.now();
        if (keepMs <= 0 && reads.get(key) === entry) reads.delete(key);
        return value;
      },
      (error: unknown) => {
        if (reads.get(key) === entry) reads.delete(key);
        throw error;
      },
    ),
  };
  reads.set(key, entry);
  return entry.promise;
}

export function forgetSharedRead(key: string): void {
  reads.delete(key);
}

export function forgetAllSharedReads(): void {
  reads.clear();
}

onApiWrite(forgetAllSharedReads);

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
