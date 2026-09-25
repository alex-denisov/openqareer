// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createLinkedInSessionImportFlow,
  missingProfileCards,
  detailPagesToRead,
  linkedinWaitingNotice,
  MAX_DETAIL_PAGES_PER_READ,
} from './linkedinSessionPoll';

const FIXTURES_DIR = join(__dirname, '__fixtures__', 'linkedin');
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf-8');
const freshThrottle = (last?: number) => {
  let at = last;
  return {
    lastReadAt: () => at,
    markRead: (next: number) => {
      at = next;
    },
  };
};

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
      pauseBetweenDetailReads: async () => {},
      detailReadThrottle: freshThrottle(),
      onAuthenticated: vi.fn(),
      onProviderDataCaptured: vi.fn(),
      onReady: vi.fn(),
    });

    // The step has to name the stage: a candidate looking at a one-time-code
    // prompt must not be shown the same silence as a page that never loaded
    // (owner report, B157).
    await expect(flow.run()).resolves.toEqual({
      status: 'waiting_for_sign_in',
      stage: 'otp',
    });
    expect(readSessionPage).not.toHaveBeenCalled();
  });

  describe('waiting notice', () => {
    it.each([
      { stage: 'loading' as const, fragment: 'Загружаем страницу LinkedIn' },
      { stage: 'login' as const, fragment: 'войдёте в LinkedIn' },
      { stage: 'otp' as const, fragment: 'одноразовый код' },
      { stage: 'captcha' as const, fragment: 'проверку' },
      { stage: 'unrecognised' as const, fragment: 'Проверяем' },
    ])('explains the $stage stage', ({ stage, fragment }) => {
      const notice = linkedinWaitingNotice(stage, 1);

      expect(notice.text).toContain(fragment);
      expect(notice.stuck).toBe(false);
    });

    it('stops claiming progress once an unrecognised page outlasts the wait', () => {
      const notice = linkedinWaitingNotice('unrecognised', 200);

      expect(notice.stuck).toBe(true);
      expect(notice.text).toMatch(/PDF-экспорт/u);
    });
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
        accountMarker: 'alexey-test',
        login: false,
        otp: false,
        captcha: false,
      }),
      readSessionPage,
      pauseBetweenDetailReads: async () => {},
      detailReadThrottle: freshThrottle(),
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
    // The main profile, then one detail read that lands back on the profile
    // (not the requested section) and so ends the walk (B266 security review).
    expect(readSessionPage).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      'closed',
      ...Array<string>(2).fill('read-profile'),
      'captured',
      'import',
    ]);
    expect(onReady.mock.calls[0]?.[0]).toMatchObject({
      rawUrl: 'https://www.linkedin.com/in/alexey-test/',
      accountMarker: 'alexey-test',
      parsed: { fullName: 'Alexey Test' },
    });

    releaseImport?.();
    await first;
  });

  it('says why the structured capture fell back to text (B266)', async () => {
    const result = await createLinkedInSessionImportFlow({
      inspectCurrentPage: async () => ({
        ready: true,
        url: 'https://www.linkedin.com/feed/',
        signedInApplicant: true,
        login: false,
        otp: false,
        captcha: false,
      }),
      readSessionPage: async (url: string) =>
        new URL(url).pathname === '/in/me/'
          ? {
              ok: true,
              url: 'https://www.linkedin.com/in/alexey-test/',
              body: '<main><div>Alexey Test</div><div>Experience</div><div>Engineer</div><div>OpenQareer</div><div>2020 - Present</div></main>',
            }
          : { ok: false as const },
      pauseBetweenDetailReads: async () => {},
      detailReadThrottle: freshThrottle(),
      onAuthenticated: vi.fn(),
      onProviderDataCaptured: vi.fn(),
      onReady: vi.fn(),
    }).run();

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.structured).toBeUndefined();
    expect(result.structuredFallback).toBe('no_substance');
  });

  it('names the profile cards the snapshot did not carry (B266)', () => {
    expect(missingProfileCards('<div componentkey="com.linkedin.sdui.profile.card.refXAbout"></div>')).toEqual([
      'missing:LanguageTopLevel',
      'missing:EducationTopLevelSection',
    ]);
    expect(
      missingProfileCards(
        ['About', 'LanguageTopLevel', 'EducationTopLevelSection']
          .map((card) => `<div componentkey="com.linkedin.sdui.profile.card.refX${card}"></div>`)
          .join(''),
      ),
    ).toEqual([]);
  });

  it('attaches a structured profile when the detail-page fixtures carry real sections', async () => {
    const pageBySuffix: [suffix: string, body: string][] = [
      ['details/experience/', readFixture('experience.html')],
      ['details/education/', readFixture('education.html')],
      ['details/skills/', readFixture('skills.html')],
      ['details/certifications/', readFixture('certifications.html')],
      ['details/projects/', readFixture('projects.html')],
      ['overlay/contact-info/', readFixture('contact-info.html')],
      ['details/recommendations/received/', readFixture('recommendations.html')],
    ];
    const readSessionPage = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/in/me/') {
        return {
          ok: true,
          url: 'https://www.linkedin.com/in/jordanrivers-99a1b2/',
          body: readFixture('profile.html'),
        };
      }
      const match = pageBySuffix.find(([suffix]) => path.endsWith(suffix));
      return match
        ? { ok: true, url: `https://www.linkedin.com${path}`, body: match[1] }
        : { ok: false as const };
    });

    const result = await createLinkedInSessionImportFlow({
      inspectCurrentPage: async () => ({
        ready: true,
        url: 'https://www.linkedin.com/feed/',
        signedInApplicant: true,
        login: false,
        otp: false,
        captcha: false,
      }),
      readSessionPage,
      pauseBetweenDetailReads: async () => {},
      detailReadThrottle: freshThrottle(),
      onAuthenticated: vi.fn(),
      onProviderDataCaptured: vi.fn(),
      onReady: vi.fn(),
    }).run();

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.structured?.extractorVersion).toBe('li-sdui-1');
    expect(result.structured?.profile.fullName).toBe('Jordan Rivers');
    expect(result.structured?.profile.experience.length).toBeGreaterThan(0);
    // Company and title never collapse into each other (the P0 defect this ticket fixes).
    const firstJob = result.structured?.profile.experience[0];
    expect(firstJob?.title).not.toMatch(/^·/u);
    expect(firstJob?.employer).not.toEqual(firstJob?.title);
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
        pauseBetweenDetailReads: async () => {},
        detailReadThrottle: freshThrottle(),
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
        pauseBetweenDetailReads: async () => {},
        detailReadThrottle: freshThrottle(),
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
        pauseBetweenDetailReads: async () => {},
        detailReadThrottle: freshThrottle(),
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
    { name: "somebody else's page", url: 'https://www.linkedin.com/company/openqareer/' },
  ])("never accepts $name as the candidate's own profile", async ({ url }) => {
    const readSessionPage = vi.fn(async () => ({ ok: true, url, body: '<h1>X</h1>' }));

    await expect(
      createLinkedInSessionImportFlow({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        pauseBetweenDetailReads: async () => {},
        detailReadThrottle: freshThrottle(),
        onAuthenticated: vi.fn(),
        onProviderDataCaptured: vi.fn(),
        onReady: vi.fn(),
        waitBeforeRetry: noWait,
      }).run(),
    ).rejects.toThrow('linkedin_authenticated_capture_failed');
  });
});

describe('LinkedIn detail pages are read at a human pace (B266, architecture §3)', () => {
  const signedIn = {
    ready: true,
    url: 'https://www.linkedin.com/feed/',
    signedInApplicant: true,
    login: false,
    otp: false,
    captcha: false,
  };
  const profile = {
    ok: true,
    url: 'https://www.linkedin.com/in/a/',
    body: '<main><h1>A</h1></main>',
  };

  function flowWith(readSessionPage: (url: string) => Promise<unknown>, extra: object = {}) {
    return createLinkedInSessionImportFlow({
      inspectCurrentPage: async () => signedIn,
      readSessionPage: readSessionPage as never,
      onAuthenticated: vi.fn(),
      onProviderDataCaptured: vi.fn(),
      onReady: vi.fn(),
      ...extra,
    });
  }

  it('caps detail pages and always ends on contact info', () => {
    const keys = detailPagesToRead();
    expect(keys.filter((key) => key !== 'contactInfo').length).toBeLessThanOrEqual(
      MAX_DETAIL_PAGES_PER_READ,
    );
    expect(keys.at(-1)).toBe('contactInfo');
  });

  it('pauses before every detail page', async () => {
    const pause = vi.fn(async () => {});
    const read = vi.fn(async () => profile);
    await flowWith(read, {
      pauseBetweenDetailReads: pause,
      detailReadThrottle: freshThrottle(),
    }).run();
    expect(pause).toHaveBeenCalledTimes(read.mock.calls.length - 1);
  });

  it('reads only the main profile within 12 hours of the last walk', async () => {
    const read = vi.fn(async () => profile);
    await flowWith(read, {
      pauseBetweenDetailReads: async () => {},
      detailReadThrottle: freshThrottle(Date.now() - 60_000),
    }).run();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops the walk when LinkedIn redirects a section to a checkpoint', async () => {
    const read = vi.fn(async (url: string) =>
      url.endsWith('/in/me/')
        ? profile
        : {
            ok: true,
            url: 'https://www.linkedin.com/checkpoint/challenge/',
            body: '<main>verify</main>',
          },
    );
    await flowWith(read, {
      pauseBetweenDetailReads: async () => {},
      detailReadThrottle: freshThrottle(),
    }).run();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('stops the walk at the first failed detail read', async () => {
    const read = vi.fn(async (url: string) => (url.endsWith('/in/me/') ? profile : { ok: false }));
    await flowWith(read, {
      pauseBetweenDetailReads: async () => {},
      detailReadThrottle: freshThrottle(),
    }).run();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('the capture scripts never fake a user gesture', () => {
  it('has no synthetic click or dispatched event', () => {
    for (const file of ['src/features/connections/linkedinSessionPoll.ts']) {
      const source = readFileSync(join(process.cwd(), file), 'utf-8');
      expect(source).not.toMatch(/\.click\(|dispatchEvent/u);
    }
  });
});
