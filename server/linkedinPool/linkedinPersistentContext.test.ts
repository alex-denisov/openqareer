import { describe, expect, it, vi } from 'vitest';
import {
  launchLinkedinPersistentContext,
  parseChromiumVersionOutput,
} from './linkedinPersistentContext';

function fakeChromium() {
  const context = { addInitScript: vi.fn(async () => undefined) };
  return {
    context,
    chromium: {
      executablePath: () => '/opt/chromium/chrome',
      launchPersistentContext: vi.fn(async (_dir: string, _options: Record<string, unknown>) => context),
    },
  };
}

describe('launchLinkedinPersistentContext', () => {
  it('parses the version printed by the Chromium binary', () => {
    expect(parseChromiumVersionOutput('Chromium 141.0.7390.37 \n')).toBe('141.0.7390.37');
    expect(parseChromiumVersionOutput('nothing')).toBeUndefined();
  });

  it('opens the account profile with a userAgent from the real version', async () => {
    const { chromium, context } = fakeChromium();
    const result = await launchLinkedinPersistentContext(chromium as never, '/profiles/acc', {
      timezone: 'Europe/Berlin',
      readVersion: async () => '141.0.7390.37',
    });
    expect(result).toBe(context);
    expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
      '/profiles/acc',
      expect.objectContaining({
        headless: true,
        timezoneId: 'Europe/Berlin',
        userAgent: expect.stringContaining('Chrome/141.0.0.0'),
      }),
    );
    expect(context.addInitScript).toHaveBeenCalledTimes(1);
  });

  it('leaves the userAgent to the browser when the version cannot be read', async () => {
    const { chromium } = fakeChromium();
    await launchLinkedinPersistentContext(chromium as never, '/profiles/acc', {
      readVersion: async () => undefined,
    });
    const options = chromium.launchPersistentContext.mock.calls[0]?.[1];
    expect(options?.userAgent).toBeUndefined();
  });
});
