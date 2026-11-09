/**
 * B626: гостевой LinkedIn через прокси Webshare. С адреса прода гостевые
 * запросы получали 429 после 8–14 запросов (09.11). Пул берёт список адресов
 * из API Webshare, обновляет его раз в 30 минут и отдаёт запросы к linkedin.com
 * по кругу; адрес, получивший 429/999, встаёт на паузу, остальные продолжают.
 * Остальные хосты (сайты компаний у резолвера) идут напрямую.
 * Без ключа API — прежнее поведение: прямой fetch.
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export interface WebshareProxy {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
}

export interface WebshareCredentials {
  readonly apiKey: string;
  readonly login?: string;
  readonly password?: string;
}

const LIST_URL = 'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100';
const REFRESH_MS = 30 * 60_000;
const LIMITED_PAUSE_MS = 30 * 60_000;
const FAILED_PAUSE_MS = 5 * 60_000;
const ATTEMPTS = 3;
const HOUR_MS = 60 * 60_000;

export function readWebshareCredentials(
  env: NodeJS.ProcessEnv = process.env,
): WebshareCredentials | undefined {
  const apiKey = env.WEBSHARE_API_KEY?.trim();
  if (!apiKey) return undefined;
  const login = env.WEBSHARE_LOGIN?.trim();
  const password = env.WEBSHARE_PASSWORD?.trim();
  return { apiKey, ...(login ? { login } : {}), ...(password ? { password } : {}) };
}

/** Разбор ответа API: только valid-адреса с портом; логин из записи или из окружения. */
export function parseWebshareList(
  payload: unknown,
  fallback: Pick<WebshareCredentials, 'login' | 'password'> = {},
): WebshareProxy[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error('webshare-list-malformed');
  const out: WebshareProxy[] = [];
  for (const raw of results as Record<string, unknown>[]) {
    if (raw?.valid === false) continue;
    const host = typeof raw?.proxy_address === 'string' ? raw.proxy_address : '';
    const port = Number(raw?.port);
    const username = typeof raw?.username === 'string' ? raw.username : (fallback.login ?? '');
    const password = typeof raw?.password === 'string' ? raw.password : (fallback.password ?? '');
    if (!host || !Number.isInteger(port) || port <= 0 || !username) continue;
    out.push({ host, port, username, password });
  }
  return out;
}

export function isLinkedinUrl(input: Parameters<typeof fetch>[0]): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

export interface WebshareStats {
  readonly proxies: number;
  readonly active: number;
  readonly paused: number;
  readonly requestsLastHour: number;
  readonly limitedLastHour: number;
  readonly listError?: string;
}

export interface WebsharePoolOptions {
  readonly credentials: WebshareCredentials;
  readonly now?: () => number;
  /** Подменяется в тестах: загрузка списка и запрос через конкретный адрес. */
  readonly loadList?: () => Promise<readonly WebshareProxy[]>;
  readonly fetchVia?: (
    proxy: WebshareProxy,
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>;
  readonly direct?: typeof fetch;
}

export interface WebsharePool {
  /** fetch: linkedin.com — через прокси по кругу, остальное — напрямую. */
  readonly fetch: typeof fetch;
  /** Число адресов в работе (минимум 1): бюджет делит на него интервал. */
  parallelism(): number;
  stats(): WebshareStats;
}

function proxyKey(proxy: WebshareProxy): string {
  return `${proxy.host}:${proxy.port}`;
}

async function defaultLoadList(credentials: WebshareCredentials): Promise<WebshareProxy[]> {
  const response = await fetch(LIST_URL, {
    headers: { Authorization: `Token ${credentials.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`webshare-list-status-${response.status}`);
  return parseWebshareList(await response.json(), credentials);
}

function defaultFetchVia(): NonNullable<WebsharePoolOptions['fetchVia']> {
  const agents = new Map<string, ProxyAgent>();
  return (proxy, input, init) => {
    const key = `${proxyKey(proxy)}|${proxy.username}`;
    let agent = agents.get(key);
    if (!agent) {
      const auth = `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}`;
      agent = new ProxyAgent(`http://${auth}@${proxy.host}:${proxy.port}`);
      agents.set(key, agent);
    }
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return undiciFetch(url, {
      ...(init as Record<string, unknown>),
      dispatcher: agent,
    }) as unknown as Promise<Response>;
  };
}

function limitedResponse(retryAfterSeconds: number): Response {
  return new Response('', {
    status: 429,
    headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

class RotatingWebsharePool implements WebsharePool {
  private readonly now: () => number;
  private readonly loadList: () => Promise<readonly WebshareProxy[]>;
  private readonly fetchVia: NonNullable<WebsharePoolOptions['fetchVia']>;
  private readonly direct: typeof fetch;
  private proxies: readonly WebshareProxy[] = [];
  private loadedAt = -Infinity;
  private loading: Promise<void> | undefined;
  private listError: string | undefined;
  private pausedUntil: ReadonlyMap<string, number> = new Map();
  private cursor = 0;
  private requests: readonly number[] = [];
  private limits: readonly number[] = [];

  constructor(options: WebsharePoolOptions) {
    this.now = options.now ?? Date.now;
    this.loadList = options.loadList ?? (() => defaultLoadList(options.credentials));
    this.fetchVia = options.fetchVia ?? defaultFetchVia();
    this.direct = options.direct ?? fetch;
  }

  readonly fetch: typeof fetch = (async (input, init) => {
    if (!isLinkedinUrl(input)) return this.direct(input, init);
    await this.ensureList();
    if (this.proxies.length === 0) return this.direct(input, init);
    return this.fetchRotating(input, init);
  }) as typeof fetch;

  parallelism(): number {
    return Math.max(1, this.activeProxies().length);
  }

  stats(): WebshareStats {
    const t = this.now();
    this.prune(t);
    const active = this.activeProxies().length;
    return {
      proxies: this.proxies.length,
      active,
      paused: this.proxies.length - active,
      requestsLastHour: this.requests.length,
      limitedLastHour: this.limits.length,
      ...(this.listError ? { listError: this.listError } : {}),
    };
  }

  private async fetchRotating(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    let lastError: unknown;
    let lastLimited: Response | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const proxy = this.nextProxy();
      if (!proxy) break;
      const t = this.now();
      this.requests = [...this.requests, t];
      try {
        const response = await this.fetchVia(proxy, input, init);
        if (response.status !== 429 && response.status !== 999) return response;
        await response.body?.cancel();
        this.pause(proxy, LIMITED_PAUSE_MS);
        this.limits = [...this.limits, t];
        lastLimited = response;
      } catch (error: unknown) {
        // Таймаут вызывающего — не вина адреса: не повторять.
        if (init?.signal?.aborted) throw error;
        this.pause(proxy, FAILED_PAUSE_MS);
        lastError = error;
      }
    }
    if (lastLimited || !lastError) return limitedResponse(this.secondsUntilFree());
    throw lastError;
  }

  private activeProxies(): WebshareProxy[] {
    const t = this.now();
    return this.proxies.filter((p) => (this.pausedUntil.get(proxyKey(p)) ?? 0) <= t);
  }

  private nextProxy(): WebshareProxy | undefined {
    const active = this.activeProxies();
    if (active.length === 0) return undefined;
    const proxy = active[this.cursor % active.length]!;
    this.cursor += 1;
    return proxy;
  }

  private pause(proxy: WebshareProxy, ms: number): void {
    const next = new Map(this.pausedUntil);
    next.set(proxyKey(proxy), this.now() + ms);
    this.pausedUntil = next;
  }

  private secondsUntilFree(): number {
    const t = this.now();
    const ends = this.proxies.map((p) => this.pausedUntil.get(proxyKey(p)) ?? t);
    return ends.length === 0 ? 60 : (Math.min(...ends) - t) / 1000;
  }

  private prune(t: number): void {
    this.requests = this.requests.filter((at) => t - at < HOUR_MS);
    this.limits = this.limits.filter((at) => t - at < HOUR_MS);
  }

  /** Первый вызов ждёт список; дальше обновление в фоне, старый список работает. */
  private async ensureList(): Promise<void> {
    if (this.now() - this.loadedAt < REFRESH_MS) return;
    if (!this.loading) {
      this.loading = this.refresh().finally(() => {
        this.loading = undefined;
      });
    }
    if (this.proxies.length === 0) await this.loading;
  }

  private async refresh(): Promise<void> {
    try {
      const list = await this.loadList();
      this.proxies = list;
      this.listError = undefined;
      const keys = new Set(list.map(proxyKey));
      this.pausedUntil = new Map([...this.pausedUntil].filter(([key]) => keys.has(key)));
    } catch (error: unknown) {
      // Список не получен: работаем со старым, без него — напрямую.
      this.listError = error instanceof Error ? error.message : 'unknown';
    } finally {
      this.loadedAt = this.now();
    }
  }
}

export function createWebsharePool(options: WebsharePoolOptions): WebsharePool {
  return new RotatingWebsharePool(options);
}
