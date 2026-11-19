import { describe, expect, it } from 'vitest';
import { parseProbeArgs } from './webkit-probe.mjs';

describe('parseProbeArgs', () => {
  it('builds the probe config with defaults', () => {
    const { config, out } = parseProbeArgs([
      '--url',
      'http://127.0.0.1:4391/app/adaptation',
      '--selector',
      '.main',
    ]);
    expect(out).toBeNull();
    expect(config).toMatchObject({
      url: 'http://127.0.0.1:4391/app/adaptation',
      width: 1440,
      height: 900,
      selectors: ['.main'],
      waitFor: null,
      settleMs: 500,
      timeoutMs: 20000,
      png: null,
      fullPage: false,
      cookies: [],
      localStorage: {},
      initScript: null,
    });
  });

  it('puts the session cookie on the host of the url and sets the theme', () => {
    const { config } = parseProbeArgs([
      '--url',
      'https://openqareer.com/app/career',
      '--width',
      '390',
      '--session',
      'tok',
      '--cookie',
      'a=b=c',
      '--theme',
      'dark',
      '--local-storage',
      'k=v',
      '--full-page',
    ]);
    expect(config.width).toBe(390);
    expect(config.fullPage).toBe(true);
    expect(config.cookies).toEqual([
      { name: 'a', value: 'b=c', domain: 'openqareer.com' },
      { name: 'openqareer_session', value: 'tok', domain: 'openqareer.com' },
    ]);
    expect(config.localStorage).toEqual({ k: 'v', oq_b640_theme: 'dark' });
  });

  it('turns a path into a file url and reads the init script', () => {
    const { config } = parseProbeArgs(
      ['--url', 'dist/index.html', '--init-script', 'stub.js'],
      () => 'window.x = 1;',
    );
    expect(config.url.startsWith('file:///')).toBe(true);
    expect(config.url.endsWith('/dist/index.html')).toBe(true);
    expect(config.initScript).toBe('window.x = 1;');
  });

  it('rejects bad input with a clear message', () => {
    expect(() => parseProbeArgs([])).toThrow('--url обязателен');
    expect(() => parseProbeArgs(['--url', 'http://x', '--width', '0'])).toThrow('--width');
    expect(() => parseProbeArgs(['--url', 'http://x', '--cookie', 'nope'])).toThrow(
      'ключ=значение',
    );
    expect(() => parseProbeArgs(['--url', 'http://x', '--theme', 'blue'])).toThrow('--theme');
    expect(() => parseProbeArgs(['--url', 'page.html', '--session', 't'])).toThrow('cookie');
  });
});
