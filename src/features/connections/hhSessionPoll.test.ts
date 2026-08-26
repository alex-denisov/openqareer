import { describe, expect, it, vi } from 'vitest';
import {
  createHhSessionImportFlow,
  createHhSessionPoller,
  hhResumeImportFailure,
  hhWaitingNotice,
  readChosenHhResume,
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

  it('keeps capture plus slow server import single-flight for a lone resume', async () => {
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
      onChoiceRequired: () => {
        events.push('asked');
      },
      onReady,
      onAuthenticatedEmpty: vi.fn(),
    });

    const first = flow.run();
    const overlapping = flow.run();
    expect(overlapping).toBe(first);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(events).toEqual(['closed', 'read-list', 'read-detail', 'import']);

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
        onChoiceRequired: () => undefined,
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
        onChoiceRequired: () => undefined,
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

/**
 * B157, отчёт владельца 2026-08-26. Аккаунт с несколькими резюме закрывал
 * диалог и оставлял нативное окно жить одно; выбор резюме стоял в мастере и
 * читал через окно, которое кандидат к тому моменту закрыл руками.
 */
describe('hh.ru session import with more than one resume', () => {
  const twoResumes =
    '<a href="/resume/resume-one" data-qa="resume-title">Product Director</a>' +
    '<a href="/resume/resume-two" data-qa="resume-title">Head of Product</a>';

  function signedInPage() {
    return {
      ready: true,
      url: 'https://hh.ru/applicant/resumes',
      signedInApplicant: true,
      login: false,
      otp: false,
      captcha: false,
    };
  }

  it('asks the candidate to choose instead of reporting a finished import', async () => {
    const onChoiceRequired = vi.fn();
    const onReady = vi.fn();
    const flow = createHhSessionImportFlow({
      inspectCurrentPage: async () => signedInPage(),
      readSessionPage: async () => ({
        ok: true,
        url: 'https://hh.ru/applicant/resumes',
        body: twoResumes,
      }),
      onAuthenticated: vi.fn(),
      onChoiceRequired,
      onReady,
      onAuthenticatedEmpty: vi.fn(),
    });

    await flow.run();

    expect(onReady).not.toHaveBeenCalled();
    expect(onChoiceRequired).toHaveBeenCalledOnce();
    expect(onChoiceRequired.mock.calls[0][0].map((item: { id: string }) => item.id)).toEqual([
      'resume-one',
      'resume-two',
    ]);
  });

  it('sends a lone resume whose page could not be read to the picker, not to the profile', async () => {
    const onChoiceRequired = vi.fn();
    const onReady = vi.fn();
    const flow = createHhSessionImportFlow({
      inspectCurrentPage: async () => signedInPage(),
      readSessionPage: async (url: string) =>
        url.includes('/applicant/resumes')
          ? {
              ok: true,
              url: 'https://hh.ru/applicant/resumes',
              body: '<a href="/resume/resume-one" data-qa="resume-title">Product Director</a>',
            }
          : { ok: false, url, body: '' },
      onAuthenticated: vi.fn(),
      onChoiceRequired,
      onReady,
      onAuthenticatedEmpty: vi.fn(),
    });

    await flow.run();

    expect(onReady).not.toHaveBeenCalled();
    expect(onChoiceRequired).toHaveBeenCalledOnce();
  });
});

describe('reading the resume the candidate chose', () => {
  const resumeUrl = 'https://hh.ru/resume/resume-one';
  const resumeBody = '<div data-qa="resume-block-title-position">Product Director</div>';

  it('reopens the sign-in window the candidate closed and reads the resume there', async () => {
    let windowOpen = false;
    const readSessionPage = vi.fn(async (url: string) => {
      if (!windowOpen) throw new Error('session_window_missing');
      return { ok: true, url, body: resumeBody };
    });
    const reopenSession = vi.fn(async () => {
      windowOpen = true;
      return true;
    });

    const parsed = await readChosenHhResume(resumeUrl, {
      readSessionPage,
      reopenSession,
    });

    expect(reopenSession).toHaveBeenCalledWith(resumeUrl);
    expect(readSessionPage).toHaveBeenCalledTimes(2);
    expect(parsed.rawText.trim()).not.toHaveLength(0);
  });

  it('says the window is gone rather than blaming the resume when it cannot be reopened', async () => {
    const readSessionPage = vi.fn(async () => {
      throw new Error('session_window_missing');
    });

    await expect(
      readChosenHhResume(resumeUrl, {
        readSessionPage,
        reopenSession: async () => false,
      }),
    ).rejects.toThrow('hh_session_window_gone');
  });

  it('reports an unreadable resume page as exactly that', async () => {
    await expect(
      readChosenHhResume(resumeUrl, {
        readSessionPage: async (url: string) => ({ ok: false, url, body: '' }),
        reopenSession: async () => true,
      }),
    ).rejects.toThrow('hh_resume_not_read');
  });
});

describe('an hh.ru account with no resumes at all', () => {
  it('reports the empty account instead of asking for a choice', async () => {
    const onChoiceRequired = vi.fn();
    const onReady = vi.fn();
    const onAuthenticatedEmpty = vi.fn();
    const flow = createHhSessionImportFlow({
      inspectCurrentPage: async () => ({
        ready: true,
        url: 'https://hh.ru/applicant/resumes',
        signedInApplicant: true,
        login: false,
        otp: false,
        captcha: false,
      }),
      readSessionPage: async () => ({
        ok: true,
        url: 'https://hh.ru/applicant/resumes',
        body: '<main data-qa="applicant-resumes-empty">Резюме пока нет</main>',
      }),
      onAuthenticated: vi.fn(),
      onChoiceRequired,
      onReady,
      onAuthenticatedEmpty,
    });

    await expect(flow.run()).resolves.toEqual({ status: 'authenticated_empty' });
    expect(onAuthenticatedEmpty).toHaveBeenCalledOnce();
    expect(onChoiceRequired).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('what the candidate is told when the chosen resume does not arrive', () => {
  it('names the closed window, the unreadable page and the unsaved profile apart', () => {
    expect(hhResumeImportFailure(new Error('hh_session_window_gone'))).toContain(
      'Окно hh.ru закрылось',
    );
    expect(hhResumeImportFailure(new Error('hh_resume_not_read'))).toContain(
      'Страница выбранного резюме не прочиталась',
    );
    expect(
      hhResumeImportFailure(new Error('hh_native_connection_not_persisted')),
    ).toContain('сервер не подтвердил сохранение');
    expect(hhResumeImportFailure(new Error('native_connection_receipt_missing'))).toContain(
      'сервер не подтвердил сохранение',
    );
  });

  /** The desktop bridge rejects with a bare code string, never with an `Error`. */
  it('falls back to one honest sentence for a code it does not know', () => {
    expect(hhResumeImportFailure('navigate_failed: EPIPE')).toBe(
      'Импортировать выбранное резюме не удалось. Повторите попытку или загрузите PDF-резюме.',
    );
    expect(hhResumeImportFailure(undefined)).toContain('Повторите попытку');
  });
});

describe('failures the chosen-resume read must not disguise', () => {
  const resumeUrl = 'https://hh.ru/resume/resume-one';

  it('lets an unrelated failure through untouched', async () => {
    await expect(
      readChosenHhResume(resumeUrl, {
        readSessionPage: async () => {
          throw new Error('page_load_timeout');
        },
        reopenSession: async () => true,
      }),
    ).rejects.toThrow('page_load_timeout');
  });

  it('gives up on a window that is gone again right after it was reopened', async () => {
    const reopenSession = vi.fn(async () => true);

    await expect(
      readChosenHhResume(resumeUrl, {
        readSessionPage: async () => {
          throw 'session_window_missing';
        },
        reopenSession,
      }),
    ).rejects.toThrow('hh_session_window_gone');
    expect(reopenSession).toHaveBeenCalledOnce();
  });
});
