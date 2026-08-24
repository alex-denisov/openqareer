import { describe, expect, it, vi } from 'vitest';
import {
  createHhSessionImportFlow,
  createHhSessionPoller,
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

    await expect(first).resolves.toEqual({ status: 'waiting_for_sign_in' });
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
});
