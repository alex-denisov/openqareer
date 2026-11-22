import type { HhSearchTransport, HhSearchTransportResult } from './hhSearchFetcher';
import type { HhFetchEvent } from './hhSearchTransport';

/**
 * B756 22.11: прямая выборка hh.ru — запрос, заголовки и всё тело — идёт в
 * отдельном потоке со своим циклом событий и своим сроком. Цикл обслуживания
 * стоял до 24 с (158 стоянок в час), и тело страницы не дочитывалось за 30 с,
 * хотя свежий процесс на том же хосте читал её за 0,4–2 с. Основной поток
 * шлёт адрес и получает строку и замеры одним сообщением. Поток один на процесс.
 */

export interface HhFetchWorkerRequest {
  readonly id: number;
  readonly url: string;
}

/** Ответ на адрес или замер одной выборки (замер — отдельным сообщением, запросы идут параллельно). */
export type HhFetchWorkerReply =
  | { readonly id: number; readonly result: HhSearchTransportResult }
  | { readonly event: HhFetchEvent };

export interface HhFetchWorkerHandle {
  postMessage(message: HhFetchWorkerRequest): void;
  on(event: 'message', listener: (message: HhFetchWorkerReply) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  unref(): void;
  terminate(): Promise<number>;
}

export type HhWorkerLog = (fields: Record<string, unknown>, message: string) => void;

export interface HhTransportInWorkerOptions {
  readonly spawn: () => HhFetchWorkerHandle;
  readonly onFetch?: (event: HhFetchEvent) => void;
  readonly log: HhWorkerLog;
  /** Страховка поверх срока выборки внутри потока (30 с). */
  readonly timeoutMs?: number;
}

export interface HhTransportInWorker {
  readonly transport: HhSearchTransport;
  /** Остановка процесса (B759): поток снимается, ожидающие получают отказ. */
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

type Failure = 'WorkerFailed' | 'WorkerExited' | 'WorkerTimeout' | 'WorkerClosed';

interface Pending {
  readonly resolve: (result: HhSearchTransportResult) => void;
  readonly timer: NodeJS.Timeout;
}

const refusal = (failure: Failure): HhSearchTransportResult => ({ status: 0, body: '', failure });

function listen(
  current: HhFetchWorkerHandle,
  options: HhTransportInWorkerOptions,
  settle: (id: number, result: HhSearchTransportResult) => void,
  drop: (failure: Failure) => void,
): void {
  current.on('message', (reply) => {
    if ('event' in reply) options.onFetch?.(reply.event);
    else settle(reply.id, reply.result);
  });
  current.on('error', (error) => {
    options.log({ errorName: error.name }, 'hh-fetch-worker-failed');
    drop('WorkerFailed');
  });
  current.on('exit', () => drop('WorkerExited'));
  // Простаивающий поток не держит процесс при остановке обслуживания.
  current.unref();
}

function createPendingTable() {
  const entries = new Map<number, Pending>();
  const settle = (id: number, result: HhSearchTransportResult): void => {
    const entry = entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entries.delete(id);
    entry.resolve(result);
  };
  return {
    settle,
    add: (id: number, entry: Pending): void => void entries.set(id, entry),
    settleAll: (result: HhSearchTransportResult): void => {
      for (const id of [...entries.keys()]) settle(id, result);
    },
  };
}

export function createHhTransportInWorker(
  options: HhTransportInWorkerOptions,
): HhTransportInWorker {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = createPendingTable();
  let worker: HhFetchWorkerHandle | undefined;
  let closed = false;
  let nextId = 1;
  const settle = pending.settle;

  const drop = (current: HhFetchWorkerHandle, failure: Failure): void => {
    if (worker !== current) return;
    worker = undefined;
    pending.settleAll(refusal(failure));
  };

  const ensureWorker = (): HhFetchWorkerHandle => {
    if (worker) return worker;
    const current = options.spawn();
    listen(current, options, settle, (failure) => drop(current, failure));
    worker = current;
    return current;
  };

  const onTimeout = (id: number, url: string, current: HhFetchWorkerHandle): void => {
    options.log({ host: new URL(url).host }, 'hh-fetch-worker-timeout');
    settle(id, refusal('WorkerTimeout'));
    drop(current, 'WorkerTimeout');
    void current.terminate().catch(() => undefined);
  };

  const transport: HhSearchTransport = (url) => {
    if (closed) return Promise.resolve(refusal('WorkerClosed'));
    const current = ensureWorker();
    const id = nextId++;
    return new Promise<HhSearchTransportResult>((resolve) => {
      const timer = setTimeout(() => onTimeout(id, url, current), timeoutMs);
      pending.add(id, { resolve, timer });
      current.postMessage({ id, url });
    });
  };

  const close = async (): Promise<void> => {
    closed = true;
    const current = worker;
    if (!current) return;
    drop(current, 'WorkerClosed');
    await current.terminate().catch(() => undefined);
  };

  return { transport, close };
}
