import { describe, expect, it, vi } from 'vitest';
import { restoreDesktopSessionToken } from './desktopSessionToken';

describe('restoreDesktopSessionToken (B327)', () => {
  it('puts the app-saved token back when WebKit lost it on quit', async () => {
    const setLocal = vi.fn();
    const restored = await restoreDesktopSessionToken({
      readSaved: async () => 'saved-token',
      getLocal: () => null,
      setLocal,
    });
    expect(restored).toBe(true);
    expect(setLocal).toHaveBeenCalledWith('saved-token');
  });

  it('keeps the WebKit token when it is there', async () => {
    const setLocal = vi.fn();
    const readSaved = vi.fn(async () => 'older');
    expect(
      await restoreDesktopSessionToken({ readSaved, getLocal: () => 'current', setLocal }),
    ).toBe(false);
    expect(readSaved).not.toHaveBeenCalled();
    expect(setLocal).not.toHaveBeenCalled();
  });

  it('stays signed out when nothing was saved or the bridge fails', async () => {
    const setLocal = vi.fn();
    expect(
      await restoreDesktopSessionToken({ readSaved: async () => null, getLocal: () => null, setLocal }),
    ).toBe(false);
    expect(
      await restoreDesktopSessionToken({
        readSaved: async () => {
          throw new Error('bridge');
        },
        getLocal: () => null,
        setLocal,
      }),
    ).toBe(false);
    expect(setLocal).not.toHaveBeenCalled();
  });
});
