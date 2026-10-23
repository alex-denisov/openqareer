import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../public/assets/oq-analytics-2.js', import.meta.url), 'utf8');
function run(path: string, consent: boolean) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: `https://openqareer.com${path}`,
    referrer: 'https://example.test/from?income=60000',
    runScripts: 'outside-only',
  });
  if (consent)
    dom.window.localStorage.setItem(
      'oq-consent-analytics',
      JSON.stringify({ ym: true, ga: true, at: new Date().toISOString() }),
    );
  dom.window.eval(script);
  dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
  return dom;
}
describe('consented public-tool analytics privacy', () => {
  it.each([
    '/tools/country-fit?income=60000',
    '/salaries/software-engineer?income=60000',
    '/salaries?income=60000',
  ])('loads only after consent and strips input-like query from pageview: %s', (path) => {
    const dom = run(path, true);
    const win = dom.window as unknown as { ym: { a: IArguments[] }; dataLayer: IArguments[] };
    const options = [...win.ym.a[0]][2];
    expect(options.webvisor).toBe(false);
    expect(options.clickmap).toBe(false);
    expect(options.url).not.toContain('60000');
    const config = win.dataLayer.map((args) => [...args]).find((args) => args[0] === 'config')!;
    expect(config[2].page_location).not.toContain('60000');
    expect(JSON.stringify([options, config])).not.toContain('income');
    dom.window.close();
  });
  it.each(['/tools/country-fit', '/salaries/software-engineer', '/salaries'])(
    'does not load counters before consent: %s',
    (path) => {
      const dom = run(path, false);
      expect(dom.window.document.querySelectorAll('script')).toHaveLength(0);
      expect(dom.window.document.querySelector('.oq-consent')).not.toBeNull();
      dom.window.close();
    },
  );
  it.each(['/app', '/admin', '/salaries/private/path'])(
    'does not expand private or unknown surfaces: %s',
    (path) => {
      const dom = run(path, true);
      expect(dom.window.document.querySelectorAll('script')).toHaveLength(0);
      dom.window.close();
    },
  );
});
