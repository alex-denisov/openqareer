import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readLinkedinPage } from './linkedinPageReader';
import { pageDelayMs } from './linkedinCadencePolicy';

const html = readFileSync(new URL('./fixtures/company-people-page.html', import.meta.url), 'utf8');
function fixture(body = html, url = 'https://www.linkedin.com/company/northwind/people/') {
  const locatorClick = vi.fn();
  return {
    locatorClick,
    content: vi.fn(async () => body), url: () => url,
    evaluate: vi.fn(async () => ({ height: 3000, viewport: 800 })),
    mouse: { wheel: vi.fn(async (_x: number, _y: number) => undefined) },
    close: vi.fn(async () => undefined), click: vi.fn(), locator: () => ({ click: locatorClick }),
  };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
describe('LinkedIn page reader', () => {
  it.each([
    ['<main data-test-id="security-verification"><h1>Verify your identity</h1></main>', 'https://www.linkedin.com/company/northwind/people/', 200, 'challenge_required'],
    [html, 'https://www.linkedin.com/checkpoint/challenge/', 200, 'challenge_required'],
    ['<input name="session_key">', 'https://www.linkedin.com/login', 200, 'login_required'],
    [html, 'https://www.linkedin.com/company/northwind/people/', 429, 'platform_restricted'],
    ['<main><div role="alert">Something went wrong</div></main>', 'https://www.linkedin.com/company/northwind/people/', 200, 'unexpected_page'],
    [html, 'https://www.linkedin.com/company/northwind/people/', 503, 'unexpected_page'],
  ] as const)('closes blocked HTML before any wheel, geometry read or delay', async (body, url, statusCode, reason) => {
    const page = fixture(body, url);
    const wait = vi.fn();
    expect(await readLinkedinPage(page, { statusCode, kind: 'read', signal: signal(), wait, random: () => 0.5 })).toMatchObject({ status: 'needs_reauth', reason });
    expect(page.close).toHaveBeenCalledOnce();
    expect(page.mouse.wheel).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });
  it('reads company HTML with unequal steps and pauses totalling the policy delay', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const pauses: number[] = [];
    const reading = readLinkedinPage(page, { kind: 'read', signal: signal(), random: () => 0.5,
      wait: async (ms) => { pauses.push(ms); await new Promise((resolve) => setTimeout(resolve, ms)); },
    });
    await vi.runAllTimersAsync();
    expect(await reading).toEqual({ status: 'ready', html });
    expect(page.mouse.wheel.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(new Set(page.mouse.wheel.mock.calls.map((call) => call[1])).size).toBeGreaterThan(1);
    expect(new Set(pauses).size).toBeGreaterThan(1);
    expect(pauses.reduce((a, b) => a + b, 0)).toBe(pageDelayMs('read', () => 0.5));
    expect(page.click).not.toHaveBeenCalled();
    expect(page.locatorClick).not.toHaveBeenCalled();
  });
  it('preserves needs_reauth even if closing the blocked page fails', async () => {
    const page = fixture('<main data-test-id="security-verification"><h1>Verify your identity</h1></main>');
    page.close.mockRejectedValue(new Error('page close failed'));
    expect(await readLinkedinPage(page, { kind: 'read', signal: signal(), random: () => 0.5,
      wait: async () => undefined,
    })).toMatchObject({ status: 'needs_reauth', reason: 'challenge_required' });
    expect(page.mouse.wheel).not.toHaveBeenCalled();
  });
  it('stops immediately when a challenge appears during reading', async () => {
    const page = fixture();
    page.content.mockResolvedValueOnce(html).mockResolvedValueOnce(html).mockResolvedValue('<main data-test-id="security-verification"><h1>Verify your identity</h1></main>');
    expect(await readLinkedinPage(page, { kind: 'read', signal: signal(), random: () => 0.5, wait: async () => undefined })).toMatchObject({ status: 'needs_reauth' });
    expect(page.mouse.wheel).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledOnce();
  });
  it('cancels during a pause without another wheel', async () => {
    const page = fixture();
    const controller = new AbortController();
    expect(await readLinkedinPage(page, { kind: 'skim', signal: controller.signal, random: () => 0.5,
      wait: async () => { controller.abort(); },
    })).toEqual({ status: 'stopped' });
    expect(page.mouse.wheel).toHaveBeenCalledTimes(1);
  });
});
