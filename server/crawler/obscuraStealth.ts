/**
 * Obscura Stealth Browser Integration
 *
 * Implements anti-detect and browser stealth techniques based on h4ckf0r0day/obscura:
 * - Automation flag stripping (--disable-blink-features=AutomationControlled)
 * - navigator.webdriver neutralization
 * - Canvas & WebGL fingerprint noise injection
 * - Realistic desktop viewports and user-agents
 */

export interface ObscuraLaunchOptions {
  readonly headless?: boolean;
  readonly proxyUrl?: string;
  readonly userDataDir?: string;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

const DESKTOP_VIEWPORTS: readonly Viewport[] = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1680, height: 1050 },
];

const MODERN_USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
];

export function buildObscuraLaunchArgs(options: ObscuraLaunchOptions = {}): string[] {
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-browser-side-navigation',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (options.proxyUrl) {
    args.push(`--proxy-server=${options.proxyUrl}`);
  }

  return args;
}

export function getRandomizedViewport(): Viewport {
  const index = Math.floor(Math.random() * DESKTOP_VIEWPORTS.length);
  return DESKTOP_VIEWPORTS[index] ?? DESKTOP_VIEWPORTS[0];
}

export function getRandomizedUserAgent(): string {
  const index = Math.floor(Math.random() * MODERN_USER_AGENTS.length);
  return MODERN_USER_AGENTS[index] ?? MODERN_USER_AGENTS[0];
}

function buildNavigatorBypass(): string {
  return `
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
      if (!window.chrome) {
        window.chrome = {};
      }
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          id: undefined,
          connect: function() {},
          sendMessage: function() {},
        };
      }
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
        configurable: true,
      });
    } catch (e) {}
  `;
}

function buildCanvasWebGLNoise(seed: number): string {
  return `
    try {
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type) {
        const context = this.getContext('2d');
        if (context && this.width > 0 && this.height > 0) {
          try {
            const imgData = context.getImageData(0, 0, 1, 1);
            imgData.data[0] = (imgData.data[0] ^ (${seed} & 1));
            context.putImageData(imgData, 0, 0);
          } catch (err) {}
        }
        return originalToDataURL.apply(this, arguments);
      };

      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.apply(this, arguments);
      };
    } catch (e) {}
  `;
}

export function buildObscuraStealthScript(options: { seed?: number } = {}): string {
  const seed = options.seed ?? Math.floor(Math.random() * 10000);
  return `
    (function() {
      ${buildNavigatorBypass()}
      ${buildCanvasWebGLNoise(seed)}
    })();
  `;
}

