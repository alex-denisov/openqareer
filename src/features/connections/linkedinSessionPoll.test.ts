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

/**
 * After the sign-in is recognised the window is hidden and the step is closed,
 * so nothing polls again. One dropped read used to discard the finished
 * sign-in and send the candidate back to the login window (B157).
 */
describe('LinkedIn capture after the sign-in is already recognised', () => {
  const signedIn = {
    ready: true,
    url: 'https://www.linkedin.com/feed/',
    signedInApplicant: true,
    login: false,
    otp: false,
    captcha: false,
  };
  const profilePage = {
    ok: true,
    url: 'https://www.linkedin.com/in/alexey-test/',
    body: '<main><h1>Alexey Test</h1><p>Product Director at OpenQareer</p></main>',
  };
  const noWait = async () => {};

  it('retries a dropped profile read instead of losing the session', async () => {
    const readSessionPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('page_load_timeout'))
      .mockResolvedValue(profilePage);
    const onReady = vi.fn();

    await expect(
      createLinkedInSessionImportFlow({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        onAuthenticated: vi.fn(),
        onProviderDataCaptured: vi.fn(),
        onReady,
        waitBeforeRetry: noWait,
      }).run(),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('signals failure only once every retry is spent', async () => {
    const readSessionPage = vi.fn(async () => ({ ok: false }));

    await expect(
      createLinkedInSessionImportFlow({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        onAuthenticated: vi.fn(),
        onProviderDataCaptured: vi.fn(),
        onReady: vi.fn(),
        waitBeforeRetry: noWait,
      }).run(),
    ).rejects.toThrow('linkedin_authenticated_capture_failed');
    expect(readSessionPage).toHaveBeenCalledTimes(3);
  });

  it('refuses a profile page that carries neither a name nor any experience', async () => {
    const readSessionPage = vi.fn(async () => ({
      ok: true,
      url: 'https://www.linkedin.com/in/alexey-test/',
      body: '<main><p>   </p></main>',
    }));

    await expect(
      createLinkedInSessionImportFlow({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        onAuthenticated: vi.fn(),
        onProviderDataCaptured: vi.fn(),
        onReady: vi.fn(),
        waitBeforeRetry: noWait,
      }).run(),
    ).rejects.toThrow('linkedin_authenticated_profile_unclassified');
  });

  it.each([
    { name: 'a look-alike host', url: 'https://linkedin.com.evil.example/in/me/' },
    { name: 'plain http', url: 'http://www.linkedin.com/in/me/' },
    { name: 'a value that is not a URL at all', url: 'not-a-url' },
    { name: 'somebody else\'s page', url: 'https://www.linkedin.com/company/openqareer/' },
  ])('never accepts $name as the candidate\'s own profile', async ({ url }) => {
    const readSessionPage = vi.fn(async () => ({ ok: true, url, body: '<h1>X</h1>' }));

    await expect(
      createLinkedInSessionImportFlow({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        onAuthenticated: vi.fn(),
        onProviderDataCaptured: vi.fn(),
        onReady: vi.fn(),
        waitBeforeRetry: noWait,
      }).run(),
    ).rejects.toThrow('linkedin_authenticated_capture_failed');
  });
});
