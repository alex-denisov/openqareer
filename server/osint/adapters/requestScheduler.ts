export interface FootprintRequestGateOptions {
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export class FootprintRequestGate {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly lastRequestAt = new Map<string, number>();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(options: FootprintRequestGateOptions = {}) {
    this.intervalMs = options.intervalMs ?? 1_000;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.wait = options.wait ?? abortableDelay;
  }

  async run<T>(
    source: string,
    signal: AbortSignal,
    request: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(source) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => next);
    this.queues.set(source, queued);
    await previous;
    try {
      const last = this.lastRequestAt.get(source);
      if (last !== undefined) {
        const elapsed = this.now() - last;
        const jitter = Math.floor(this.random() * 251);
        const delay = Math.max(0, this.intervalMs + jitter - elapsed);
        await this.wait(delay, signal);
      }
      if (signal.aborted) throw signal.reason;
      this.lastRequestAt.set(source, this.now());
      return await request();
    } finally {
      release();
      if (this.queues.get(source) === queued) this.queues.delete(source);
    }
  }
}

export const sharedFootprintRequestGate = new FootprintRequestGate();
