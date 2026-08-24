import { describe, expect, it, vi } from 'vitest';
import { createLinkedInSessionImportFlow } from './linkedinSessionPoll';

describe('LinkedIn session import flow', () => {
  it('waits through login and MFA without navigating the provider webview', async () => {
    const readSessionPage = vi.fn();
    const flow = createLinkedInSessionImportFlow({
      inspectCurrentPage: async () => ({
        ready: true,
        url: 'https://www.linkedin.com/checkpoint/challenge/',
        signedInApplicant: false,
        login: false,
        otp: true,
        captcha: false,
      }),
      readSessionPage,
      onAuthenticated: vi.fn(),
      onProviderDataCaptured: vi.fn(),
      onReady: vi.fn(),
    });

    await expect(flow.run()).resolves.toEqual({ status: 'waiting_for_sign_in' });
    expect(readSessionPage).not.toHaveBeenCalled();
  });

  it('captures the own profile, closes provider UI, then persists exactly once', async () => {
    const events: string[] = [];
    let releaseImport: (() => void) | undefined;
    const onReady = vi.fn(
      (_result: unknown) =>
        new Promise<void>((resolve) => {
          events.push('import');
          releaseImport = resolve;
        }),
    );
    const readSessionPage = vi.fn(async () => {
      events.push('read-profile');
      return {
        ok: true,
        url: 'https://www.linkedin.com/in/alexey-test/',
        body: '<main><h1>Alexey Test</h1><section>Product Director\nExample GmbH\n2022 — настоящее время</section></main>',
      };
    });
    const flow = createLinkedInSessionImportFlow({
      inspectCurrentPage: async () => ({
        ready: true,
        url: 'https://www.linkedin.com/feed/',
        signedInApplicant: true,
        login: false,
        otp: false,
        captcha: false,
      }),
      readSessionPage,
      onAuthenticated: async () => {
        events.push('closed');
      },
      onProviderDataCaptured: async () => {
        events.push('captured');
      },
      onReady,
    });

    const first = flow.run();
    const overlapping = flow.run();
    expect(overlapping).toBe(first);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(readSessionPage).toHaveBeenCalledOnce();
    expect(events).toEqual(['closed', 'read-profile', 'captured', 'import']);
    expect(onReady.mock.calls[0]?.[0]).toMatchObject({
      rawUrl: 'https://www.linkedin.com/in/alexey-test/',
      parsed: { fullName: 'Alexey Test' },
    });

    releaseImport?.();
    await first;
  });
});
