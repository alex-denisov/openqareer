/**
 * B643: один рендер в браузере для страницы карьеры, где список вакансий
 * рисует скрипт. Обычный headless Google Chrome со своим UA: без подмены
 * отпечатка, без обхода защит и без запасного пути через stealth.
 *
 * Один общий браузер на процесс, не больше двух страниц сразу, страница
 * ограничена ~35 с, картинки, стили, трекеры, шрифты и медиа не грузятся. Каждый запрос
 * выполняет Node через защиту от SSRF (siteRenderGuard, pinnedFetch),
 * WebSocket закрываются, service workers выключены, итоговый адрес страницы
 * проверяется перед чтением HTML. Браузер
 * закрывается после минуты простоя: память обслуживания под потолком cgroup.
 */

import { createPinnedSession, type PinnedSession } from './pinnedFetch';
import { createRequestGuard, isRenderableUrl, type GuardedRoute } from './siteRenderGuard';

/** Отрисованный HTML страницы или undefined, если отрисовать не вышло. */
export type RenderScriptPage = (url: string) => Promise<string | undefined>;

export interface RenderPage {
  route(pattern: string, handler: (route: GuardedRoute) => Promise<void>): Promise<void>;
  routeWebSocket(url: RegExp, handler: (ws: { close(): Promise<void> }) => unknown): Promise<void>;
  url(): string;
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForSelector(
    selector: string,
    options: { state: 'attached'; timeout: number },
  ): Promise<unknown>;
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
  /** Сессия запросов одного рендера с проверкой адреса при соединении. */
  readonly createFetch?: () => PinnedSession;
}

const DEFAULT_MAX_CONCURRENT = 2;
/** Бюджет страницы: медленные сайты отдают TLS и первый байт за 2-4 с (замер 11.11). */
const DEFAULT_PAGE_TIMEOUT_MS = 35_000;
/** После DOM ждём ссылку на вакансию не дольше этого, но в пределах бюджета. */
const JOB_ANCHOR_WAIT_MS = 8_000;
const DEFAULT_IDLE_CLOSE_MS = 30_000;
/** Ссылки и виджеты, по которым каскад узнаёт вакансии. */
const JOB_ANCHOR_SELECTOR = [
  'a[href*="/job"]',
  'a[href*="/vacanc"]',
  'a[href*="vacancy"]',
  'a[href*="/position"]',
  'a[href*="/opening"]',
  'a[href*="/stelle"]',
  'a[href*="jobid"]',
  'script[type="application/ld+json"]',
  'iframe[src*="greenhouse"]',
  'iframe[src*="lever.co"]',
].join(', ');

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

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

interface RenderRequest {
  readonly url: string;
  readonly timeoutMs: number;
  readonly createFetch: () => PinnedSession;
  readonly log: RenderLog;
}

async function renderOnce(
  browser: RenderBrowser,
  request: RenderRequest,
): Promise<string | undefined> {
  const session = request.createFetch();
  const guard = createRequestGuard(session.fetch);
  const startedAt = Date.now();
  // Service worker отвечает в обход page.route, поэтому выключен.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => guard.handle(route));
    // WebSocket идёт мимо page.route: закрывается, не дойдя до сети.
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: request.timeoutMs });
    // Список рисует скрипт уже после DOM: ждём первую ссылку на вакансию, не дольше остатка бюджета.
    const left = request.timeoutMs - (Date.now() - startedAt);
    const wait = Math.max(1, Math.min(JOB_ANCHOR_WAIT_MS, left));
    await page
      .waitForSelector(JOB_ANCHOR_SELECTOR, { state: 'attached', timeout: wait })
      .catch(() => undefined);
    if (!isRenderableUrl(page.url())) return undefined;
    const html = await page.content();
    logDone(request.log, request.url, startedAt, html);
    return html;
  } finally {
    session.close();
    await context.close().catch(() => undefined);
  }
}

function logDone(log: RenderLog, url: string, startedAt: number, html: string): void {
  log(
    { host: new URL(url).host, ms: Date.now() - startedAt, htmlChars: html.length },
    'site-render-page-done',
  );
}

function renderRequest(
  url: string,
  options: ScriptPageRendererOptions,
  log: RenderLog,
): RenderRequest {
  return {
    url,
    timeoutMs: options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS,
    createFetch: options.createFetch ?? (() => createPinnedSession()),
    log,
  };
}

/** Откат OPENQAREER_SITE_RENDER_OFF=1 или адрес, который рендерить нельзя. */
function skipRender(env: NodeJS.ProcessEnv, url: string): boolean {
  return env.OPENQAREER_SITE_RENDER_OFF?.trim() === '1' || !isRenderableUrl(url);
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
    if (skipRender(options.env ?? process.env, url)) return undefined;
    return limit(async () => {
      if (idleTimer) clearTimeout(idleTimer);
      inFlight += 1;
      try {
        const current = await acquire();
        if (!current) return undefined;
        return await renderOnce(current, renderRequest(url, options, log));
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

/**
 * Песочница Chrome не выключается: страница чужая. Куча V8 каждой страницы
 * ограничена 256 МБ: обслуживание живёт под MemoryMax cgroup.
 */
const PLAIN_CHROME_ARGS = ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=256'];

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
