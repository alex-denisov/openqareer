import { describe, expect, it } from 'vitest';
import {
  buildObscuraLaunchArgs,
  buildObscuraStealthScript,
  getRandomizedViewport,
  getRandomizedUserAgent,
} from '../obscuraStealth';

describe('Obscura stealth browser integration', () => {
  it('generates anti-detect chromium arguments removing automation flags', () => {
    const args = buildObscuraLaunchArgs({
      headless: true,
      proxyUrl: 'http://proxy.internal:8080',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--proxy-server=http://proxy.internal:8080',
      ]),
    );
  });

  it('generates stealth script removing navigator.webdriver and injecting WebGL/Canvas noise', () => {
    const script = buildObscuraStealthScript({ seed: 42 });

    expect(script).toContain("'webdriver'");
    expect(script).toContain('window.chrome');
    expect(script).toContain('HTMLCanvasElement.prototype.toDataURL');
    expect(script).toContain('WebGLRenderingContext.prototype.getParameter');
  });

  it('returns valid desktop viewports and recent user agent strings', () => {
    const vp = getRandomizedViewport();
    expect(vp.width).toBeGreaterThanOrEqual(1280);
    expect(vp.height).toBeGreaterThanOrEqual(720);

    const ua = getRandomizedUserAgent();
    expect(ua).toMatch(/Mozilla\/5\.0.*Chrome\/[0-9]+.*Safari/);
    expect(ua).not.toContain('Headless');
  });
});
