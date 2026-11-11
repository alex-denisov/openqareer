/**
 * B643: один рендер в браузере для страницы карьеры, где список вакансий
 * рисует скрипт. Обычный headless Google Chrome со своим UA: без подмены
 * отпечатка, без обхода защит и без запасного пути через stealth.
 *
 * Один общий браузер на процесс, не больше двух страниц сразу, страница
 * ограничена ~20 с, картинки, шрифты и медиа не грузятся. Каждый запрос
 * проходит защиту от SSRF (siteRenderGuard), service workers выключены,
 * итоговый адрес страницы проверяется перед чтением HTML. Браузер
 * закрывается после минуты простоя: память обслуживания под потолком cgroup.
 */

import { createRequestGuard, type GuardedRoute, type HostIsPublic } from './siteRenderGuard';

/** Отрисованный HTML страницы или undefined, если отрисовать не вышло. */
export type RenderScriptPage = (url: string) => Promise<string | undefined>;

export interface RenderPage {
  route(pattern: string, handler: (route: GuardedRoute) => Promise<void>): Promise<void>;
  url(): string;
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForLoadState(state: 'networkidle', options: { timeout: number }): Promise<void>;
  content(): Promise<string>;
  close(): Promise<void>;
}

export interface RenderContext {
  newPage(): Promise<RenderPage>;
  close(): Promise<void>;
}

export interface RenderBrowser {
  newContext(options: { serviceWorkers: 'block' }): Promise<RenderContext>;
  isConnected(): boolean;
  close(): Promise<void>;
}

export type RenderLog = (fields: Record<string, unknown>, message: string) => void;

export interface ScriptPageRendererOptions {
  readonly launch: () => Promise<RenderBrowser>;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: RenderLog;
  readonly maxConcurrent?: number;
  readonly pageTimeoutMs?: number;
  readonly idleCloseMs?: number;
  /** Проверка DNS хоста; по умолчанию все адреса должны быть публичными. */
  readonly hostIsPublic?: HostIsPublic;
}

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_PAGE_TIMEOUT_MS = 20_000;
const NETWORK_IDLE_MS = 5_000;
const DEFAULT_IDLE_CLOSE_MS = 60_000;

function createSemaphore(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

interface RenderRequest {
  readonly url: string;
  readonly timeoutMs: number;
  readonly hostIsPublic: HostIsPublic | undefined;
}

async function renderOnce(
  browser: RenderBrowser,
  request: RenderRequest,
): Promise<string | undefined> {
  const guard = createRequestGuard(request.hostIsPublic);
  if (!(await guard.isAllowed(request.url))) return undefined;
  // Service worker отвечает в обход page.route, поэтому выключен.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => guard.handle(route));
    await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: request.timeoutMs });
    // Сеть может не стихнуть из-за аналитики: ждём недолго и берём то, что есть.
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
    if (!(await guard.isAllowed(page.url()))) return undefined;
    return await page.content();
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function createScriptPageRenderer(options: ScriptPageRendererOptions): RenderScriptPage {
  const log = options.log ?? (() => undefined);
  const limit = createSemaphore(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  let browser: Promise<RenderBrowser> | undefined;
  let unavailable = false;
  let inFlight = 0;
  let idleTimer: NodeJS.Timeout | undefined;

  const closeIdle = (): void => {
    const current = browser;
    browser = undefined;
    void current?.then((b) => b.close()).catch(() => undefined);
  };

  const acquire = async (): Promise<RenderBrowser | undefined> => {
    if (unavailable) return undefined;
    const existing = browser ? await browser.catch(() => undefined) : undefined;
    if (existing?.isConnected()) return existing;
    browser = options.launch();
    try {
      return await browser;
    } catch (error: unknown) {
      browser = undefined;
      unavailable = true;
      log({ errorName: errorName(error) }, 'site-render-browser-unavailable');
      return undefined;
    }
  };

  return async (url) => {
    if ((options.env ?? process.env).OPENQAREER_SITE_RENDER_OFF?.trim() === '1' || !isHttpUrl(url))
      return undefined;
    return limit(async () => {
      if (idleTimer) clearTimeout(idleTimer);
      inFlight += 1;
      try {
        const current = await acquire();
        if (!current) return undefined;
        const timeoutMs = options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
        return await renderOnce(current, { url, timeoutMs, hostIsPublic: options.hostIsPublic });
      } catch (error: unknown) {
        log({ errorName: errorName(error), host: new URL(url).host }, 'site-render-page-failed');
        return undefined;
      } finally {
        inFlight -= 1;
        if (inFlight === 0 && browser) {
          idleTimer = setTimeout(closeIdle, options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS);
          idleTimer.unref();
        }
      }
    });
  };
}

/** Песочница Chrome не выключается: страница чужая. */
const PLAIN_CHROME_ARGS = ['--disable-dev-shm-usage'];

/**
 * Запуск на проде: тот же Google Chrome (B626) и тот же модуль playwright,
 * что у обслуживания, но headless и без флагов маскировки LinkedIn.
 */
export async function launchSiteRenderBrowser(
  moduleSpecifier: string,
  executablePath: string | undefined,
): Promise<RenderBrowser> {
  const { chromium } = (await import(moduleSpecifier)) as {
    chromium: { launch(options: Record<string, unknown>): Promise<RenderBrowser> };
  };
  return chromium.launch({
    headless: true,
    args: PLAIN_CHROME_ARGS,
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
  });
}
