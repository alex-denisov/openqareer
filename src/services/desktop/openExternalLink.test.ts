// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as desktopBridge from './desktopBridge';
import { openExternalLink } from './openExternalLink';

describe('openExternalLink (B266)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses window.open with noopener in the web build', async () => {
    vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(false);
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    await openExternalLink('https://example.com/job');
    expect(openSpy).toHaveBeenCalledWith('https://example.com/job', '_blank', 'noopener');
  });

  it('does not throw and does not call window.open when no URL is given', async () => {
    vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(false);
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    await openExternalLink('');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'not a url'])(
    'never opens a non-web link from a third-party board: %s',
    async (url) => {
      vi.spyOn(desktopBridge, 'isTauriEnvironment').mockReturnValue(false);
      const openSpy = vi.fn();
      vi.stubGlobal('open', openSpy);
      await openExternalLink(url);
      expect(openSpy).not.toHaveBeenCalled();
    },
  );
});
