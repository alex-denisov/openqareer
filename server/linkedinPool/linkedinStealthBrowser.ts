import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright';

export interface LinkedinStealthOptions {
  readonly timezone?: string;
  readonly proxyUrl?: string;
  /** Версия запущенного Chromium (`browser.version()`): из неё строится UA. */
  readonly browserVersion?: string;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 } as const;

/** UA честной платформы: Linux и настоящая мажорная версия запущенного Chromium. */
export function buildLinkedinUserAgent(browserVersion: string): string | undefined {
  const major = /^(\d{2,3})\./u.exec(browserVersion.trim())?.[1];
  if (!major) return undefined;
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// Sec-Fetch-* и sec-ch-* браузер выставляет сам и по-разному для документа и скриптов;
// подмена на каждом запросе роняла загрузку скриптов LinkedIn (прод 04.10).
const CLIENT_HINTS_HEADERS: Readonly<Record<string, string>> = {
  'Accept-Language': 'en-US,en;q=0.9',
};

export function getLinkedinChromiumLaunchArgs(options: { proxyUrl?: string } = {}): string[] {
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-browser-side-navigation',
    '--window-size=1440,900',
  ];
  const proxy = options.proxyUrl ?? process.env.OPENQAREER_LINKEDIN_PROXY_URL?.trim();
  if (proxy) {
    args.push(`--proxy-server=${proxy}`);
  }
  return args;
}

export function getLinkedinStealthContextOptions(
  options: LinkedinStealthOptions = {},
): BrowserContextOptions {
  const userAgent = options.browserVersion
    ? buildLinkedinUserAgent(options.browserVersion)
    : undefined;
  return {
    viewport: DEFAULT_VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: options.timezone ?? 'Europe/Berlin',
    ...(userAgent ? { userAgent } : {}),
    extraHTTPHeaders: CLIENT_HINTS_HEADERS,
  };
}

const NAVIGATOR_STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const list = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      ];
      list.item = (i) => list[i] || null;
      list.namedItem = (name) => list.find((p) => p.name === name) || null;
      list.refresh = () => {};
      return list;
    },
    configurable: true,
  });
`;

const CHROME_RUNTIME_SCRIPT = `
  if (!window.chrome) { window.chrome = {}; }
  window.chrome.runtime = window.chrome.runtime || {
    connect: function() {},
    sendMessage: function() {},
    onMessage: { addListener: function() {}, removeListener: function() {} },
  };
  window.chrome.app = window.chrome.app || { isInstalled: false };
  window.chrome.csi = window.chrome.csi || function() {};
  window.chrome.loadTimes = window.chrome.loadTimes || function() {};
`;

const HARDWARE_PERMISSIONS_SCRIPT = `
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 37445) return 'Intel Inc.';
    if (p === 37446) return 'Intel(R) UHD Graphics 630';
    return getParam.apply(this, arguments);
  };
  if (window.WebGL2RenderingContext) {
    const getParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel(R) UHD Graphics 630';
      return getParam2.apply(this, arguments);
    };
  }
  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (p) => (
    p && p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission || 'default' })
      : origQuery.apply(this, arguments)
  );
  delete window.cdc_adoQx080412DTGIytWhAhflag_Promise;
  delete window.__webdriver_evaluate;
  delete window.__selenium_evaluate;
`;

export function buildLinkedinStealthInitScript(): string {
  return `try {\n${NAVIGATOR_STEALTH_SCRIPT}\n${CHROME_RUNTIME_SCRIPT}\n${HARDWARE_PERMISSIONS_SCRIPT}\n} catch (e) {}`;
}

export async function createLinkedinStealthContext(
  browser: Browser,
  options: LinkedinStealthOptions = {},
): Promise<BrowserContext> {
  const browserVersion =
    options.browserVersion ?? (typeof browser.version === 'function' ? browser.version() : undefined);
  const contextOptions = getLinkedinStealthContextOptions({
    ...options,
    ...(browserVersion ? { browserVersion } : {}),
  });
  const context = await browser.newContext(contextOptions);
  await installLinkedinStealthScript(context);
  return context;
}

/** Один и тот же отпечаток для чистого и постоянного контекста. */
export async function installLinkedinStealthScript(context: BrowserContext): Promise<void> {
  if (typeof context.addInitScript === 'function') {
    await context.addInitScript(buildLinkedinStealthInitScript());
  }
}
