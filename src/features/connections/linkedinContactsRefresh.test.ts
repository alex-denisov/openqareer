import { describe, expect, it, vi } from 'vitest';
import { refreshLinkedInContacts } from './linkedinContactsRefresh';

function deps(overrides: Partial<Parameters<typeof refreshLinkedInContacts>[0]> = {}) {
  return {
    isDesktop: true,
    linkedinConnected: true,
    throttle: { lastReadAt: () => undefined, markRead: vi.fn() },
    openOutOfSight: vi.fn().mockResolvedValue(true),
    importContacts: vi.fn().mockResolvedValue({ status: 'uploading', count: 3 }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('contacts-only LinkedIn refresh (B448)', () => {
  it('opens the session out of sight, reads contacts, then closes it', async () => {
    const d = deps();
    await expect(refreshLinkedInContacts(d)).resolves.toEqual({ status: 'uploading', count: 3 });
    expect(d.openOutOfSight).toHaveBeenCalledOnce();
    expect(d.importContacts).toHaveBeenCalledOnce();
    expect(d.close).toHaveBeenCalledOnce();
    expect(d.throttle.markRead).toHaveBeenCalledOnce();
  });

  it('does nothing outside the desktop app or without a LinkedIn connection', async () => {
    const web = deps({ isDesktop: false });
    const unlinked = deps({ linkedinConnected: false });
    await expect(refreshLinkedInContacts(web)).resolves.toEqual({
      status: 'skipped',
      reason: 'not_eligible',
    });
    await expect(refreshLinkedInContacts(unlinked)).resolves.toEqual({
      status: 'skipped',
      reason: 'not_eligible',
    });
    expect(web.openOutOfSight).not.toHaveBeenCalled();
    expect(unlinked.openOutOfSight).not.toHaveBeenCalled();
  });

  it('runs at most once per 24 h', async () => {
    const d = deps({
      throttle: { lastReadAt: () => Date.now() - 60 * 60 * 1000, markRead: vi.fn() },
    });
    await expect(refreshLinkedInContacts(d)).resolves.toEqual({
      status: 'skipped',
      reason: 'recently_read',
    });
    expect(d.openOutOfSight).not.toHaveBeenCalled();
  });

  it('closes the window and never throws when the read fails', async () => {
    const d = deps({ importContacts: vi.fn().mockRejectedValue(new Error('page_load_timeout')) });
    await expect(refreshLinkedInContacts(d)).resolves.toEqual({
      status: 'skipped',
      reason: 'read_failed',
    });
    expect(d.close).toHaveBeenCalledOnce();
  });

  it('stops when the window cannot be opened', async () => {
    const d = deps({ openOutOfSight: vi.fn().mockResolvedValue(false) });
    await expect(refreshLinkedInContacts(d)).resolves.toEqual({
      status: 'skipped',
      reason: 'window_unavailable',
    });
    expect(d.importContacts).not.toHaveBeenCalled();
  });

  it('leaves a window the candidate is using alone', async () => {
    const d = deps({ isSessionOpen: vi.fn().mockResolvedValue(true) });
    await expect(refreshLinkedInContacts(d)).resolves.toEqual({
      status: 'skipped',
      reason: 'window_unavailable',
    });
    expect(d.openOutOfSight).not.toHaveBeenCalled();
    expect(d.close).not.toHaveBeenCalled();
  });
});
