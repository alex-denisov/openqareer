// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
const script = readFileSync('public/assets/oq-analytics-3.js', 'utf8');
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete window.ym;
  delete window.gtag;
  delete window.dataLayer;
  vi.useRealTimers();
});
describe('salary skill-list document analytics boundary', () => {
  it('disables recordings and sanitizes SDK metadata even after consent and typed private input', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'location',
      new URL('https://openqareer.com/salaries/analyst?secret=private-input'),
    );
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://example.com/private?secret=private-input',
    });
    localStorage.setItem(
      'oq-consent-analytics',
      JSON.stringify({ ym: true, ga: true, at: new Date().toISOString() }),
    );
    document.body.innerHTML =
      '<section class="ym-hide-content"><textarea class="ym-disable-keys"></textarea></section>';
    window.eval(script);
    document.querySelector('textarea').value = 'private-input';
    window.dispatchEvent(new Event('pointerdown'));
    const yandex = Array.from(window.ym.a[0]);
    expect(yandex[2]).toMatchObject({
      webvisor: false,
      clickmap: false,
      url: 'https://openqareer.com/salaries/analyst',
      referrer: 'https://example.com',
    });
    const google = Array.from(window.dataLayer).map((args) => Array.from(args));
    expect(google.find((args) => args[0] === 'config')[2]).toMatchObject({
      page_location: 'https://openqareer.com/salaries/analyst',
      page_referrer: 'https://example.com',
      page_title: 'Public career tool',
    });
    expect(JSON.stringify([yandex, google])).not.toContain('private-input');
    expect(script).not.toContain('oq-salary-gap');
  });
});
