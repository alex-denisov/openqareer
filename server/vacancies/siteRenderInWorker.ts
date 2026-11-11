import { isRenderableUrl } from './siteRenderGuard';
import type { RenderLog, RenderScriptPage } from './scriptPageRenderer';

/**
 * B643 11.11: рендер идёт в отдельном потоке со своим циклом событий.
 * Каждый запрос страницы проходит через Node (page.route → pinnedFetch →
 * fulfill), и на проде цикл обслуживания занят на 100 % (p50 задержки
 * 563 мс, стоянки до 6 с): страница в 2-3 с превращалась в 27-40 с и
 * упиралась в TimeoutError. Поток отвечает только за рендер; основной
 * цикл шлёт адрес и получает HTML одним сообщением.
 */

export interface RenderWorkerRequest {
  readonly id: number;
  readonly url: string;
}

export type RenderWorkerReply =
  | { readonly id: number; readonly html?: string }
  | { readonly log: { readonly fields: Record<string, unknown>; readonly message: string } };

export interface RenderWorkerHandle {
  postMessage(message: RenderWorkerRequest): void;
  on(event: 'message', listener: (message: RenderWorkerReply) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  unref(): void;
  terminate(): Promise<number>;
}

export interface RenderInWorkerOptions {
  readonly spawn: () => RenderWorkerHandle;
  readonly log: RenderLog;
  /** Ответ потока на один адрес: бюджет страницы, запуск браузера и очередь внутри потока. */
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Адресов в потоке одновременно; остальные ждут здесь, и их бюджет ещё не идёт. */
  readonly maxConcurrent?: number;
}

/** Страница 35 с + ссылка на вакансию 8 с + запуск Chrome и очередь из двух страниц. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Как в потоке: не больше двух страниц сразу. */
const DEFAULT_MAX_CONCURRENT = 2;

interface Pending {
  readonly resolve: (html: string | undefined) => void;
  readonly timer: NodeJS.Timeout;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function listen(
  current: RenderWorkerHandle,
  log: RenderLog,
  settle: (id: number, html: string | undefined) => void,
  drop: () => void,
): void {
  current.on('message', (reply) => {
    if ('log' in reply) log(reply.log.fields, reply.log.message);
    else settle(reply.id, reply.html);
  });
  current.on('error', (error) => {
    log({ errorName: errorName(error) }, 'site-render-worker-failed');
    drop();
  });
  current.on('exit', drop);
  // Простаивающий поток не держит процесс при остановке обслуживания.
  current.unref();
}

/** Места в потоке: освободившееся место переходит следующему в очереди, не освобождаясь. */
function createSlots(limit: number) {
  const queued: Array<() => void> = [];
  let active = 0;
  return {
    /** Свободное место занимается сразу, без ожидания. */
    take(): boolean {
      if (active >= limit) return false;
      active += 1;
      return true;
    },
    wait(): Promise<void> {
      return new Promise<void>((go) => queued.push(go));
    },
    release(): void {
      const next = queued.shift();
      if (next) next();
      else active -= 1;
    },
  };
}

export function createRenderInWorker(options: RenderInWorkerOptions): RenderScriptPage {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const slots = createSlots(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  const pending = new Map<number, Pending>();
  let worker: RenderWorkerHandle | undefined;
  let nextId = 1;

  const settle = (id: number, html: string | undefined): void => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(html);
    slots.release();
  };

  const drop = (current: RenderWorkerHandle): void => {
    if (worker !== current) return;
    worker = undefined;
    for (const id of [...pending.keys()]) settle(id, undefined);
  };

  const ensureWorker = (): RenderWorkerHandle => {
    if (worker) return worker;
    const current = options.spawn();
    listen(current, options.log, settle, () => drop(current));
    worker = current;
    return current;
  };

  const onTimeout = (id: number, url: string, current: RenderWorkerHandle): void => {
    options.log({ host: new URL(url).host }, 'site-render-worker-timeout');
    settle(id, undefined);
    drop(current);
    void current.terminate().catch(() => undefined);
  };

  const send = (url: string): Promise<string | undefined> => {
    const current = ensureWorker();
    const id = nextId++;
    return new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => onTimeout(id, url, current), timeoutMs);
      pending.set(id, { resolve, timer });
      current.postMessage({ id, url });
    });
  };

  return async (url) => {
    const env = options.env ?? process.env;
    if (env.OPENQAREER_SITE_RENDER_OFF?.trim() === '1' || !isRenderableUrl(url)) return undefined;
    if (!slots.take()) await slots.wait();
    return send(url);
  };
}
