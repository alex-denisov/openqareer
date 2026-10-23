import { describe, expect, it, vi } from 'vitest';
import {
  refreshLinkedInContacts,
  scheduleLinkedInContactsRefresh,
} from './linkedinContactsRefresh';

function deps(overrides: Partial<Parameters<typeof refreshLinkedInContacts>[0]> = {}) {
  return {
    isDesktop: true,
    linkedinConnected: true,
    throttle: {
      lastReadAt: (): number | undefined => undefined,
      markRead: vi.fn<(at: number) => void>(),
    },
    openOutOfSight: vi.fn().mockResolvedValue(true),
    importContacts: vi
      .fn()
      .mockResolvedValue({ status: 'uploading', count: 3, parsed: 12, withCompany: 5 }),
    close: vi.fn().mockResolvedValue(undefined),
    prepareRoute: vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) }),
    log: vi.fn(),
    ...overrides,
  };
}

describe('contacts-only LinkedIn refresh (B448)', () => {
  it('opens the session out of sight, reads contacts, then closes it', async () => {
    const d = deps();
    await expect(refreshLinkedInContacts(d)).resolves.toEqual({
      status: 'uploading',
      count: 3,
      parsed: 12,
      withCompany: 5,
    });
    expect(d.openOutOfSight).toHaveBeenCalledOnce();
    expect(d.importContacts).toHaveBeenCalledOnce();
    expect(d.close).toHaveBeenCalledOnce();
    expect(d.throttle.markRead).toHaveBeenCalledOnce();
  });

  it('does nothing outside the desktop app or without a LinkedIn connection', async () => {
    const web = deps({ isDesktop: false });
    const unlinked = deps({ linkedinConnected: false });
    await expect(refreshLinkedInContacts(web)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'not_eligible',
    });
    await expect(refreshLinkedInContacts(unlinked)).resolves.toMatchObject({
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
    await expect(refreshLinkedInContacts(d)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'recently_read',
    });
    expect(d.openOutOfSight).not.toHaveBeenCalled();
  });

  it('closes the window and never throws when the read fails', async () => {
    const d = deps({ importContacts: vi.fn().mockRejectedValue(new Error('page_load_timeout')) });
    await expect(refreshLinkedInContacts(d)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'read_failed',
    });
    expect(d.close).toHaveBeenCalledOnce();
  });

  it('stops when the window cannot be opened', async () => {
    const d = deps({ openOutOfSight: vi.fn().mockResolvedValue(false) });
    await expect(refreshLinkedInContacts(d)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'window_unavailable',
    });
    expect(d.importContacts).not.toHaveBeenCalled();
  });

  it('leaves a window the candidate is using alone', async () => {
    const d = deps({ isSessionOpen: vi.fn().mockResolvedValue(true) });
    await expect(refreshLinkedInContacts(d)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'window_unavailable',
    });
    expect(d.openOutOfSight).not.toHaveBeenCalled();
    expect(d.close).not.toHaveBeenCalled();
  });

  it('brings the protected route up before the window and releases it after', async () => {
    const order: string[] = [];
    const release = vi.fn(async () => {
      order.push('release');
    });
    const d = deps({
      prepareRoute: vi.fn(async () => {
        order.push('route');
        return { release };
      }),
      openOutOfSight: vi.fn(async () => {
        order.push('open');
        return true;
      }),
      close: vi.fn(async () => {
        order.push('close');
      }),
    });
    await refreshLinkedInContacts(d);
    expect(order).toEqual(['route', 'open', 'close', 'release']);
  });

  it('logs a route failure and does not open the window', async () => {
    const d = deps({ prepareRoute: vi.fn().mockRejectedValue(new Error('tunnel_start_failed')) });
    await expect(refreshLinkedInContacts(d)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'route_unavailable',
    });
    expect(d.openOutOfSight).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith('route_unavailable', 'tunnel_start_failed');
  });

  it('spends the 24 h gate only on a real read; a failure retries after an hour', async () => {
    const now = Date.now();
    const failed = deps({
      importContacts: vi.fn().mockResolvedValue({
        status: 'skipped',
        reason: 'read_failed',
        detail: 'page_load_timeout',
      }),
    });
    await refreshLinkedInContacts(failed);
    const marked = vi.mocked(failed.throttle.markRead).mock.calls[0]?.[0] as number;
    expect(now + 60 * 60 * 1000 - marked).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5_000);
    expect(failed.log).toHaveBeenCalledWith('read_failed', 'page_load_timeout');

    const done = deps();
    await refreshLinkedInContacts(done);
    expect(
      Math.abs((vi.mocked(done.throttle.markRead).mock.calls[0]?.[0] as number) - Date.now()),
    ).toBeLessThan(5_000);
    expect(done.log).toHaveBeenCalledWith('parsed', '12');
    expect(done.log).toHaveBeenCalledWith('with_company', '5');
    expect(done.log).toHaveBeenCalledWith('uploading', '3');
  });
});

describe('contacts refresh scheduling (B448)', () => {
  it('starts only after the delay, so the account load comes first', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    scheduleLinkedInContactsRefresh(start, 30_000);
    vi.advanceTimersByTime(29_999);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('does not start when the screen closes before the delay', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const cancel = scheduleLinkedInContactsRefresh(start, 30_000);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(start).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
