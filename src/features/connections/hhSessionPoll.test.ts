import { describe, expect, it, vi } from 'vitest';
import {
  createHhSessionImportFlow,
  createHhSessionPoller,
  hhWaitingNotice,
  readHhResumeFromSession,
} from './hhSessionPoll';

describe('hh.ru session polling', () => {
  it('coalesces overlapping polls and never navigates away from login verification', async () => {
    let releaseInspection: ((page: {
      ready: boolean;
      url: string;
      signedInApplicant: boolean;
      login: boolean;
      otp: boolean;
      captcha: boolean;
    }) => void) | undefined;
    const inspectCurrentPage = vi.fn(
      () =>
        new Promise<{
          ready: boolean;
          url: string;
          signedInApplicant: boolean;
          login: boolean;
          otp: boolean;
          captcha: boolean;
        }>((resolve) => {
          releaseInspection = resolve;
        }),
    );
    const readSessionPage = vi.fn();
    const poller = createHhSessionPoller({ inspectCurrentPage, readSessionPage });

    const first = poller.poll();
    const overlapping = poller.poll();

    expect(overlapping).toBe(first);
    expect(inspectCurrentPage).toHaveBeenCalledTimes(1);

    releaseInspection?.({
      ready: true,
      url: 'https://hh.ru/account/login?step=otp',
      signedInApplicant: false,
      login: true,
      otp: true,
      captcha: false,
    });

    await expect(first).resolves.toEqual({
      status: 'waiting_for_sign_in',
      stage: 'otp',
    });
    expect(readSessionPage).not.toHaveBeenCalled();
  });

  /**
   * A single opaque `waiting_for_sign_in` made "the page is still loading",
   * "hh.ru is asking for a code" and "the candidate is signed in but we do not
   * recognise the page" look identical on screen — nothing changed, ever. The
   * last of those is the owner-reported symptom, and it was the invisible one
   * (B157).
   */
  it.each([
    {
      name: 'the page has not finished loading',
      page: {
        ready: false,
        url: 'https://hh.ru/account/login',
        signedInApplicant: false,
        login: false,
        otp: false,
        captcha: false,
      },
      stage: 'loading',
    },
    {
      name: 'hh.ru is showing its own sign-in form',
      page: {
        ready: true,
        url: 'https://hh.ru/account/login',
        signedInApplicant: false,
        login: true,
        otp: false,
        captcha: false,
      },
      stage: 'login',
    },
    {
      name: 'hh.ru is asking for a one-time code',
      page: {
        ready: true,
        url: 'https://hh.ru/account/login',
        signedInApplicant: false,
        login: false,
        otp: true,
        captcha: false,
      },
      stage: 'otp',
    },
    {
      name: 'hh.ru is showing a captcha',
      page: {
        ready: true,
        url: 'https://hh.ru/account/login',
        signedInApplicant: false,
        login: false,
        otp: false,
        captcha: true,
      },
      stage: 'captcha',
    },
    {
      name: 'the page is ready, is not a challenge, and carries no signed-in marker',
      page: {
        ready: true,
        url: 'https://hh.ru/',
        signedInApplicant: false,
        login: false,
        otp: false,
        captcha: false,
      },
      stage: 'unrecognised',
    },
  ])('names the waiting stage when $name', async ({ page, stage }) => {
    const inspectCurrentPage = vi.fn(async () => page);
    const readSessionPage = vi.fn();

    await expect(
      createHhSessionPoller({ inspectCurrentPage, readSessionPage }).poll(),
    ).resolves.toEqual({ status: 'waiting_for_sign_in', stage });
    expect(readSessionPage).not.toHaveBeenCalled();
  });

  it('reads the exact selected resume through the supplied cookie-bearing session', async () => {
    const readCurrentSession = vi.fn(async (url: string) => ({
      ok: true,
      url,
      body: '<div data-qa="resume-block-title-position">Product Director</div>',
    }));

    const parsed = await readHhResumeFromSession(
      'https://hh.ru/resume/resume-selected',
      readCurrentSession,
    );

    expect(readCurrentSession).toHaveBeenCalledOnce();
    expect(readCurrentSession).toHaveBeenCalledWith(
      'https://hh.ru/resume/resume-selected',
    );
    expect(parsed?.targetRole).toBe('Product Director');
  });

  it('returns a found list when the optional first-resume reading fails', async () => {
    const inspectCurrentPage = vi.fn(async () => ({
      ready: true,
      url: 'https://hh.ru/applicant/resumes',
      signedInApplicant: true,
      login: false,
      otp: false,
      captcha: false,
    }));
    const readSessionPage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://hh.ru/applicant/resumes',
        body: '<a href="/resume/resume-selected" data-qa="resume-title">Product Director</a>',
      })
      .mockRejectedValueOnce(new Error('detail page timed out'));

    await expect(
      createHhSessionPoller({ inspectCurrentPage, readSessionPage }).poll(),
    ).resolves.toEqual({
      status: 'ready',
      resumes: [
        {
          id: 'resume-selected',
          title: 'Product Director',
          url: 'https://hh.ru/resume/resume-selected',
          updatedLabel: 'Готово к импорту',
        },
      ],
      defaultParsed: undefined,
      rawUrl: 'https://hh.ru/resume/resume-selected',
    });
  });

  it('distinguishes an authenticated account whose resume list is empty', async () => {
    const inspectCurrentPage = vi.fn(async () => ({
      ready: true,
      url: 'https://hh.ru/applicant/resumes',
      signedInApplicant: true,
      login: false,
      otp: false,
      captcha: false,
    }));
    const readSessionPage = vi.fn(async () => ({
      ok: true,
      url: 'https://hh.ru/applicant/resumes',
      body: '<main><h1>Мои резюме</h1><p>Резюме пока нет</p></main>',
    }));

    await expect(
      createHhSessionPoller({ inspectCurrentPage, readSessionPage }).poll(),
    ).resolves.toEqual({ status: 'authenticated_empty' });
  });

  it('does not read or import an arbitrary first resume when several are available', async () => {
    const readSessionPage = vi.fn(async () => ({
      ok: true,
      url: 'https://hh.ru/applicant/resumes',
      body: [
        '<a href="/resume/resume-one" data-qa="resume-title">Product Director</a>',
        '<a href="/resume/resume-two" data-qa="resume-title">COO</a>',
      ].join(''),
    }));

    await expect(
      createHhSessionPoller({
        inspectCurrentPage: async () => ({
          ready: true,
          url: 'https://hh.ru/applicant/resumes',
          signedInApplicant: true,
          login: false,
          otp: false,
          captcha: false,
        }),
        readSessionPage,
      }).poll(),
    ).resolves.toMatchObject({
      status: 'ready',
      resumes: [
        { id: 'resume-one' },
        { id: 'resume-two' },
      ],
      defaultParsed: undefined,
      rawUrl: undefined,
    });
    expect(readSessionPage).toHaveBeenCalledOnce();
  });

  it('keeps capture plus slow server import single-flight and closes provider UI before import', async () => {
    const events: string[] = [];
    let releaseImport: (() => void) | undefined;
    const onReady = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          events.push('import');
          releaseImport = resolve;
        }),
    );
    const flow = createHhSessionImportFlow({
      inspectCurrentPage: async () => ({
        ready: true,
        url: 'https://hh.ru/applicant/resumes',
        signedInApplicant: true,
        login: false,
        otp: false,
        captcha: false,
      }),
      readSessionPage: vi.fn(async (url: string) => {
          events.push(url.includes('/applicant/resumes') ? 'read-list' : 'read-detail');
          return url.includes('/applicant/resumes')
            ? {
                ok: true,
                url: 'https://hh.ru/applicant/resumes',
                body: '<a href="/resume/resume-one" data-qa="resume-title">Product Director</a>',
              }
            : {
                ok: true,
                url: 'https://hh.ru/resume/resume-one',
                body: '<div data-qa="resume-block-title-position">Product Director</div>',
              };
        }),
      onAuthenticated: async () => {
        events.push('closed');
      },
      onProviderDataCaptured: async () => {
        events.push('captured');
      },
      onReady,
      onAuthenticatedEmpty: vi.fn(),
    });

    const first = flow.run();
    const overlapping = flow.run();
    expect(overlapping).toBe(first);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(events).toEqual([
      'closed',
      'read-list',
      'read-detail',
      'captured',
      'import',
    ]);

    releaseImport?.();
    await first;
  });

  /**
   * The step must say where it stands at every moment. Silence is what the
   * owner reported, and silence is also what an undetected sign-in looks like,
   * so the unrecognised stage has to stop being patient at some point and offer
   * the candidate another way through (B157).
   */
  describe('the page hh.ru really serves for the resume list', () => {
    const signedIn = {
      ready: true,
      url: 'https://hh.ru/applicant/profile/me',
      signedInApplicant: true,
      login: false,
      otp: false,
      captcha: false,
    };
    const resumeCard =
      '<a data-qa="resume-card-link-live-token-1" href="/resume/live-token-1">Менеджер по продукту</a>';

    it('accepts the redirect hh.ru answers /applicant/resumes with', async () => {
      // hh.ru redirects the resume list to /applicant/profile/me. Rejecting it
      // made the capture fail on the page it had just asked for (B157).
      const flow = createHhSessionImportFlow({
        inspectCurrentPage: async () => signedIn,
        readSessionPage: async () => ({
          ok: true,
          url: 'https://hh.ru/applicant/profile/me',
          body: `<main>${resumeCard}</main>`,
        }),
        onAuthenticated: () => undefined,
        onProviderDataCaptured: () => undefined,
        onReady: () => undefined,
        onAuthenticatedEmpty: () => undefined,
        waitBeforeRetry: async () => undefined,
      });

      const result = await flow.run();

      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.resumes.map((resume) => resume.id)).toEqual(['live-token-1']);
    });

    it('still refuses a look-alike host serving the same path', async () => {
      const flow = createHhSessionImportFlow({
        inspectCurrentPage: async () => signedIn,
        readSessionPage: async () => ({
          ok: true,
          url: 'https://hh.ru.example.invalid/applicant/profile/me',
          body: `<main>${resumeCard}</main>`,
        }),
        onAuthenticated: () => undefined,
        onProviderDataCaptured: () => undefined,
        onReady: () => undefined,
        onAuthenticatedEmpty: () => undefined,
        waitBeforeRetry: async () => undefined,
      });

      await expect(flow.run()).rejects.toThrow('hh_authenticated_capture_failed');
    });
  });

  describe('waiting notice', () => {
    it.each([
      { stage: 'loading' as const, fragment: 'Загружаем страницу hh.ru' },
      { stage: 'login' as const, fragment: 'войдёте в hh.ru' },
      { stage: 'otp' as const, fragment: 'одноразовый код' },
      { stage: 'captcha' as const, fragment: 'проверку' },
      { stage: 'unrecognised' as const, fragment: 'Проверяем' },
    ])('explains the $stage stage', ({ stage, fragment }) => {
      const notice = hhWaitingNotice(stage, 1);

      expect(notice.text).toContain(fragment);
      expect(notice.stuck).toBe(false);
    });

    it('stops claiming progress once an unrecognised page outlasts the wait', () => {
      const notice = hhWaitingNotice('unrecognised', 200);

      expect(notice.stuck).toBe(true);
      expect(notice.text).toContain('не узнаёт страницу hh.ru');
      expect(notice.text).toContain('PDF');
    });

    it('keeps waiting on a challenge hh.ru itself is showing, however long it takes', () => {
      for (const stage of ['loading', 'login', 'otp', 'captcha'] as const) {
        expect(hhWaitingNotice(stage, 200).stuck).toBe(false);
      }
    });
  });
});

/**
 * The candidate has already signed in: the window is hidden and the modal is
 * closed, so nothing polls again. One transient read of the resume list used
 * to throw the finished sign-in away and send the candidate back to the login
 * window from scratch (B157).
 */
describe('hh.ru capture after the sign-in is already recognised', () => {
  const signedIn = {
    ready: true,
    url: 'https://hh.ru/applicant/resumes',
    signedInApplicant: true,
    login: false,
    otp: false,
    captcha: false,
  };
  const listBody =
    '<a href="/resume/resume-selected" data-qa="resume-title">Product Director</a>';
  const noWait = vi.fn(async () => {});

  it('retries a resume list read that came back empty instead of losing the session', async () => {
    const readSessionPage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, url: 'https://hh.ru/applicant/resumes' })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://hh.ru/applicant/resumes',
        body: listBody,
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://hh.ru/resume/resume-selected',
        body: '<div data-qa="resume-block-title-position">Product Director</div>',
      });

    await expect(
      createHhSessionPoller({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        waitBeforeRetry: noWait,
      }).poll(),
    ).resolves.toMatchObject({
      status: 'ready',
      resumes: [{ id: 'resume-selected' }],
    });
  });

  it('retries a resume list read that failed with a transient desktop error', async () => {
    const readSessionPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('page_load_timeout: hh.ru'))
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://hh.ru/applicant/resumes',
        body: listBody,
      })
      .mockResolvedValue({ ok: false });

    await expect(
      createHhSessionPoller({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        waitBeforeRetry: noWait,
      }).poll(),
    ).resolves.toMatchObject({ status: 'ready' });
  });

  it('signals the candidate only once every retry of the resume list is spent', async () => {
    const readSessionPage = vi.fn(async () => ({ ok: false, url: 'https://hh.ru/' }));

    await expect(
      createHhSessionPoller({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        waitBeforeRetry: noWait,
      }).poll(),
    ).rejects.toThrow('hh_authenticated_capture_failed');
    expect(readSessionPage.mock.calls.length).toBeGreaterThan(1);
  });

  it('hides the sign-in window once, not once per retry', async () => {
    const onAuthenticated = vi.fn();
    const readSessionPage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://hh.ru/applicant/resumes',
        body: listBody,
      })
      .mockResolvedValue({ ok: false });

    await createHhSessionPoller({
      inspectCurrentPage: async () => signedIn,
      readSessionPage,
      onAuthenticated,
      waitBeforeRetry: noWait,
    }).poll();

    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it('does not retry a page hh.ru is challenging — that needs the candidate, not another read', async () => {
    const readSessionPage = vi.fn(async () => ({
      ok: true,
      url: 'https://hh.ru/applicant/resumes',
      body: '<div data-qa="account-login-page">account/login</div>',
    }));

    await expect(
      createHhSessionPoller({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        waitBeforeRetry: noWait,
      }).poll(),
    ).rejects.toThrow('hh_authenticated_capture_failed');
    expect(readSessionPage).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'a look-alike host', url: 'https://hh.ru.evil.example/applicant/resumes' },
    { name: 'plain http', url: 'http://hh.ru/applicant/resumes' },
  ])('never parses $name as the candidate own resume list', async ({ url }) => {
    const readSessionPage = vi.fn(async () => ({
      ok: true,
      url,
      body: listBody,
    }));

    await expect(
      createHhSessionPoller({
        inspectCurrentPage: async () => signedIn,
        readSessionPage,
        waitBeforeRetry: noWait,
      }).poll(),
    ).rejects.toThrow('hh_authenticated_capture_failed');
  });
});
