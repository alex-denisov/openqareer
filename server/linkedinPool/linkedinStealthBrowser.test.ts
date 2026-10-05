import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import {
  buildLinkedinStealthInitScript,
  buildLinkedinUserAgent,
  createLinkedinStealthContext,
  getLinkedinChromiumLaunchArgs,
  getLinkedinStealthContextOptions,
} from './linkedinStealthBrowser';

describe('linkedinStealthBrowser', () => {
  describe('getLinkedinChromiumLaunchArgs', () => {
    it('returns hardened anti-detect arguments removing automation flags', () => {
      const args = getLinkedinChromiumLaunchArgs();
      expect(args).toContain('--disable-blink-features=AutomationControlled');
      expect(args).toContain('--no-sandbox');
      expect(args).toContain('--disable-infobars');
      expect(args).toContain('--window-size=1440,900');
    });

    it('attaches proxy server argument when proxyUrl is supplied', () => {
      const args = getLinkedinChromiumLaunchArgs({ proxyUrl: 'http://127.0.0.1:8888' });
      expect(args).toContain('--proxy-server=http://127.0.0.1:8888');
    });
  });

  describe('getLinkedinStealthContextOptions', () => {
    it('provides consistent desktop viewport and a userAgent built from the real version', () => {
      const options = getLinkedinStealthContextOptions({
        timezone: 'Europe/Berlin',
        browserVersion: '134.0.6998.35',
      });
      expect(options.viewport).toEqual({ width: 1440, height: 900 });
      expect(options.deviceScaleFactor).toBe(1);
      expect(options.timezoneId).toBe('Europe/Berlin');
      expect(options.locale).toBe('en-US');
      expect(options.userAgent).toMatch(/Mozilla\/5\.0.*Chrome\/134\.0\.0\.0.*Safari\/537\.36/);
      expect(options.userAgent).not.toContain('Headless');
    });

    // B373: литерал Chrome/131 не совпадал с настоящим Chromium.
    it('does not invent a userAgent when the browser version is unknown', () => {
      expect(getLinkedinStealthContextOptions().userAgent).toBeUndefined();
    });

    // Прод 04.10: Sec-Fetch-* и sec-ch-* на каждом запросе роняли загрузку скриптов
    // static.licdn.com (net::ERR_INVALID_ARGUMENT) — страница людей не отрисовывалась.
    // Эти заголовки браузер выставляет сам; подменяем только язык.
    it('sends only Accept-Language and leaves Sec-Fetch and Client Hints to the browser', () => {
      const options = getLinkedinStealthContextOptions();
      const headers = options.extraHTTPHeaders as Record<string, string>;
      expect(headers['Accept-Language']).toContain('en-US');
      expect(Object.keys(headers).filter((name) => /^sec-|^upgrade-/iu.test(name))).toEqual([]);
    });
  });

  describe('buildLinkedinUserAgent', () => {
    it('uses the major of the launched Chromium on Linux', () => {
      expect(buildLinkedinUserAgent('141.0.7390.37')).toBe(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      );
    });

    it('rejects a version string without a numeric major', () => {
      expect(buildLinkedinUserAgent('weird')).toBeUndefined();
    });
  });

  describe('buildLinkedinStealthInitScript', () => {
    it('removes navigator.webdriver and emulates window.chrome and plugins', () => {
      const script = buildLinkedinStealthInitScript();
      expect(script).toContain("'webdriver'");
      expect(script).toContain('window.chrome');
      expect(script).toContain("'languages'");
      expect(script).toContain('PDF Viewer');
      expect(script).toContain('WebGLRenderingContext');
      // Must NOT contain random canvas poisoning that breaks canvas determinism
      expect(script).not.toContain('Math.random()');
    });
  });

  describe('createLinkedinStealthContext', () => {
    it('configures newContext and registers the stealth init script', async () => {
      const initScriptCalls: string[] = [];
      const fakeContext = {
        addInitScript: vi.fn(async (s: string) => {
          initScriptCalls.push(s);
        }),
      };
      const fakeBrowser = {
        newContext: vi.fn(async () => fakeContext),
        version: () => '141.0.7390.37',
      } as unknown as Browser;

      const context = await createLinkedinStealthContext(fakeBrowser, {
        timezone: 'UTC',
      });

      expect(fakeBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({
          timezoneId: 'UTC',
          userAgent: expect.stringContaining('Chrome/141.0.0.0'),
          viewport: { width: 1440, height: 900 },
        }),
      );
      expect(fakeContext.addInitScript).toHaveBeenCalledTimes(1);
      expect(initScriptCalls[0]).toContain("'webdriver'");
      expect(context).toBe(fakeContext);
    });
  });
});
