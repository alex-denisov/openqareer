import type { Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HhBrowserFactory, verifyHhTestAccount } from './hhBrowserLogin';

const syntheticEnvironment = {
  OPENQAREER_HH_TEST_USERNAME: 'synthetic-candidate@example.test',
  OPENQAREER_HH_TEST_PASSWORD: 'synthetic-password-not-a-secret',
};

/**
 * Models the live hh.ru applicant sign-in observed on 2026-08-16: account type,
 * then credential type plus email, then the password surface.
 */
const loginFixture = `
  <!doctype html>
  <html lang="ru">
    <head><meta charset="utf-8" /><title>Вход в личный кабинет</title></head>
    <body>
      <main>
        <form aria-label="Вход">
          <section id="step-account">
            <label><input type="radio" name="account-type" data-qa="account-type-card-APPLICANT" checked />Соискатель</label>
            <label><input type="radio" name="account-type" data-qa="account-type-card-EMPLOYER" />Работодатель</label>
          </section>
          <section id="step-credential" hidden>
            <label><input type="radio" name="credential" data-qa="credential-type-phone" checked />Телефон</label>
            <label><input type="radio" name="credential" data-qa="credential-type-email" />Почта</label>
            <input name="login" data-qa="applicant-login-input-email" hidden />
            <button type="button" data-qa="expand-login-by-password" hidden>Войти с паролем</button>
          </section>
          <section id="step-password" hidden>
            <input name="password" type="password" data-qa="applicant-login-input-password" />
          </section>
          <button type="submit" data-qa="submit-button">Войти</button>
        </form>
        <script>
          const account = document.querySelector('#step-account');
          const credential = document.querySelector('#step-credential');
          const passwordStep = document.querySelector('#step-password');
          const emailField = document.querySelector('[data-qa="applicant-login-input-email"]');
          const emailMode = document.querySelector('[data-qa="credential-type-email"]');
          const passwordMode = document.querySelector('[data-qa="expand-login-by-password"]');
          emailMode.addEventListener('change', () => {
            emailField.hidden = false;
            passwordMode.hidden = false;
          });
          passwordMode.addEventListener('click', () => {
            credential.hidden = true;
            passwordStep.hidden = false;
          });
          document.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            if (!account.hidden) {
              account.hidden = true;
              credential.hidden = false;
              return;
            }
            const login = emailField.value;
            const password = document.querySelector('[name=password]').value;
            if (
              login === 'synthetic-candidate@example.test' &&
              password === 'synthetic-password-not-a-secret'
            ) {
              window.location.assign('/applicant/resumes');
              return;
            }
            document.querySelector('main').insertAdjacentHTML(
              'beforeend',
              '<p data-qa="account-login-error">Неверный логин или пароль</p>',
            );
          });
        </script>
      </main>
    </body>
  </html>
`;

/**
 * Mirrors the live `/applicant/resumes` card observed on 2026-08-16: the card
 * carries the internal numeric id, the public hash id lives on the card link,
 * and the "Обновлено …" label plus the two visibility counters sit inside it.
 */
function resumeCard(options: {
  hashId: string;
  internalId: string;
  title: string;
  updated: string;
  searchShows?: string;
  newViews?: string;
}): string {
  return `
        <div data-qa="resume" data-qa-id="${options.internalId}" data-qa-title="${options.title}">
          <a data-qa="resume-card-link-${options.hashId}" href="/resume/${options.hashId}?hhtmFrom=resume_list">
            <div data-qa="resume-title"><h3 data-qa="title">${options.title}</h3></div>
            <div data-qa="title-description">Обновлено <span>${options.updated}</span></div>
          </a>
          ${options.searchShows ? `<div data-qa="search-shows"><div>Показы</div><div>${options.searchShows}</div></div>` : ''}
          ${options.newViews ? `<a data-qa="count-new-views" href="/applicant/resumeview/history"><div>Просмотры</div><div>${options.newViews}</div></a>` : ''}
          <button type="button" data-qa="resume-update-button resume-update-button_actions">Обновить дату</button>
        </div>`;
}

const ownerResumeId = '260801e7ff10eeac690039ed1f4f655a417a35';
const secondResumeId = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function resumesPage(cards: string): string {
  return `
  <!doctype html>
  <html lang="ru">
    <head><meta charset="utf-8" /><title>Мои резюме</title></head>
    <body>
      <header><a data-qa="mainmenu_applicantProfile" href="/applicant/profile">Профиль</a></header>
      <main>
        <h1>Мои резюме</h1>
        <span data-qa="applicant-email">synthetic-candidate@example.test</span>
${cards}
      </main>
    </body>
  </html>
`;
}

const resumeFixture = resumesPage(
  resumeCard({
    hashId: ownerResumeId,
    internalId: '284077161',
    title: 'Synthetic Product Manager',
    updated: '9 августа 2026 в 16:09',
    searchShows: '12',
    newViews: '3',
  }),
);

const twoResumeFixture = resumesPage(
  [
    resumeCard({
      hashId: ownerResumeId,
      internalId: '284077161',
      title: 'Synthetic Product Manager',
      updated: '9 августа 2026 в 16:09',
      searchShows: '12',
      newViews: '3',
    }),
    resumeCard({
      hashId: secondResumeId,
      internalId: '284077162',
      title: 'Synthetic Delivery Lead',
      updated: '1 августа 2026 в 09:30',
    }),
  ].join('\n'),
);

const foreignResumeFixture = resumeFixture.replace(
  'synthetic-candidate@example.test</span>',
  'someone-else@example.test</span>',
);

const captchaLoginFixture = `
  <!doctype html>
  <html lang="ru">
    <head><meta charset="utf-8" /><title>Проверка</title></head>
    <body><main><div data-qa="captcha">Подтвердите, что вы не робот</div></main></body>
  </html>
`;

const mfaResumeFixture = `
  <!doctype html>
  <html lang="ru">
    <head><meta charset="utf-8" /><title>Подтверждение входа</title></head>
    <body>
      <main>
        <label>Код из письма<input name="otpCode" autocomplete="one-time-code" /></label>
      </main>
    </body>
  </html>
`;

describe('hh.ru read-only test-account verifier', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30_000);

  it('returns ready only after login and an exact candidate resume identity marker', async () => {
    const requests: string[] = [];
    const browserFactory = withHhRoutes(browser, requests, {
      login: loginFixture,
      resumes: resumeFixture,
    });

    const result = await verifyHhTestAccount(browserFactory, {
      environment: syntheticEnvironment,
      observedAt: () => '2026-08-14T14:00:00.000Z',
      timeoutMs: 2_000,
    });

    expect(requests).toEqual(['GET /account/login', 'GET /applicant/resumes']);
    expect(result).toEqual({
      status: 'ready',
      reason: 'candidate_resume_identity_verified',
      identityMarker: 'candidate_resume_owner_match',
      observedAt: '2026-08-14T14:00:00.000Z',
      resumes: [
        {
          id: ownerResumeId,
          title: 'Synthetic Product Manager',
          updatedLabel: 'Обновлено 9 августа 2026 в 16:09',
          url: `https://hh.ru/resume/${ownerResumeId}`,
          searchShows: { label: 'Показы', count: 12 },
          newViews: { label: 'Просмотры', count: 3 },
        },
      ],
    });
    expect(requests.every((entry) => entry.startsWith('GET '))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(
      syntheticEnvironment.OPENQAREER_HH_TEST_USERNAME,
    );
    expect(JSON.stringify(result)).not.toContain(
      syntheticEnvironment.OPENQAREER_HH_TEST_PASSWORD,
    );
    expect(browser.contexts()).toHaveLength(0);
  });

  it('lists every resume on the account rather than a single hard-coded one', async () => {
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, [], {
        login: loginFixture,
        resumes: twoResumeFixture,
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-16T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('ready');
    expect(result.resumes.map((resume) => resume.id)).toEqual([
      ownerResumeId,
      secondResumeId,
    ]);
    expect(result.resumes[1]).toEqual({
      id: secondResumeId,
      title: 'Synthetic Delivery Lead',
      updatedLabel: 'Обновлено 1 августа 2026 в 09:30',
      url: `https://hh.ru/resume/${secondResumeId}`,
      searchShows: null,
      newViews: null,
    });
  });

  it('binds identity to the owner-declared resume id when one is configured', async () => {
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, [], {
        login: loginFixture,
        // hh.ru does not print the account email on the live surface.
        resumes: twoResumeFixture.replace('data-qa="applicant-email"', 'data-qa="removed"'),
      }),
      {
        environment: {
          ...syntheticEnvironment,
          OPENQAREER_HH_TEST_RESUME_ID: ownerResumeId,
        },
        observedAt: () => '2026-08-16T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('ready');
    expect(result.reason).toBe('candidate_resume_identity_verified');
    expect(result.identityMarker).toBe('declared_resume_owner_match');
  });

  it('stops fail-closed when the declared resume id is absent from the account', async () => {
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, [], {
        login: loginFixture,
        resumes: twoResumeFixture,
      }),
      {
        environment: {
          ...syntheticEnvironment,
          OPENQAREER_HH_TEST_RESUME_ID: 'ffffffffffffffffffffffffffffffffffffff',
        },
        observedAt: () => '2026-08-16T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('surface_changed');
    expect(result.reason).toBe('declared_resume_missing');
    expect(result.identityMarker).toBeNull();
  });

  it('refuses to confirm a resume surface that belongs to another account', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: loginFixture,
        resumes: foreignResumeFixture,
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('surface_changed');
    expect(result.reason).toBe('identity_marker_mismatch');
    expect(result.identityMarker).toBeNull();
    expect(browser.contexts()).toHaveLength(0);
  });

  it('stops fail-closed on a CAPTCHA wall instead of attempting to solve it', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: captchaLoginFixture,
        resumes: resumeFixture,
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result).toEqual({
      status: 'challenge',
      reason: 'challenge_detected',
      identityMarker: null,
      observedAt: '2026-08-14T14:00:00.000Z',
      resumes: [],
    });
    expect(requests).toEqual(['GET /account/login']);
  });

  it('reports mfa as an owner-handled stop when a one-time code is requested', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: loginFixture,
        resumes: mfaResumeFixture,
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('mfa');
    expect(result.reason).toBe('mfa_required');
  });

  it('reports a rejected credential without leaking it', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: loginFixture,
        resumes: resumeFixture,
      }),
      {
        environment: {
          OPENQAREER_HH_TEST_USERNAME: 'synthetic-candidate@example.test',
          OPENQAREER_HH_TEST_PASSWORD: 'wrong-password',
        },
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 1_000,
      },
    );

    expect(result.status).toBe('invalid');
    expect(result.reason).toBe('login_rejected');
    expect(requests).toEqual(['GET /account/login']);
    expect(JSON.stringify(result)).not.toContain('wrong-password');
  });

  it('reports only a confirmed session when hh.ru prints no account email', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: loginFixture,
        resumes: resumeFixture.replace('data-qa="applicant-email"', 'data-qa="removed"'),
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result).toEqual({
      status: 'ready',
      reason: 'candidate_session_confirmed',
      identityMarker: 'signed_in_applicant_session',
      observedAt: '2026-08-14T14:00:00.000Z',
      resumes: [
        {
          id: ownerResumeId,
          title: 'Synthetic Product Manager',
          updatedLabel: 'Обновлено 9 августа 2026 в 16:09',
          url: `https://hh.ru/resume/${ownerResumeId}`,
          searchShows: { label: 'Показы', count: 12 },
          newViews: { label: 'Просмотры', count: 3 },
        },
      ],
    });
  });

  it('stops when the login form is no longer the surface it was built for', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login:
          '<!doctype html><html><head><meta charset="utf-8" /><title>hh.ru</title></head><body><main>Страница изменилась</main></body></html>',
        resumes: resumeFixture,
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 500,
      },
    );

    expect(result.status).toBe('surface_changed');
    expect(result.reason).toBe('login_surface_changed');
    expect(requests).toEqual(['GET /account/login']);
  });

  it('refuses a resume page that carries no signed-in applicant marker', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: loginFixture,
        resumes: resumeFixture.replace('data-qa="mainmenu_applicantProfile"', 'data-qa="removed"'),
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('surface_changed');
    expect(result.reason).toBe('candidate_surface_changed');
  });

  it('refuses a candidate surface that exposes no resume of its own', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: loginFixture,
        resumes: resumeFixture.replace('data-qa="resume-title"', 'data-qa="resume-removed"'),
      }),
      {
        environment: syntheticEnvironment,
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('surface_changed');
    expect(result.reason).toBe('resume_marker_missing');
  });

  it('never opens a browser context when credentials are absent', async () => {
    const requests: string[] = [];
    const result = await verifyHhTestAccount(
      withHhRoutes(browser, requests, {
        login: loginFixture,
        resumes: resumeFixture,
      }),
      {
        environment: { OPENQAREER_HH_TEST_USERNAME: '   ' },
        observedAt: () => '2026-08-14T14:00:00.000Z',
        timeoutMs: 1_000,
      },
    );

    expect(result).toEqual({
      status: 'invalid',
      reason: 'credential_environment_missing',
      identityMarker: null,
      observedAt: '2026-08-14T14:00:00.000Z',
      resumes: [],
    });
    expect(requests).toEqual([]);
  });
});

function withHhRoutes(
  browser: Browser,
  requests: string[],
  fixtures: { login: string; resumes: string },
): HhBrowserFactory {
  return {
    async newContext(options): Promise<BrowserContext> {
      const context = await browser.newContext(options);
      await context.route('https://hh.ru/**', async (route) => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        requests.push(`${request.method()} ${pathname}`);
        if (pathname === '/account/login') {
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: fixtures.login,
          });
          return;
        }
        if (pathname === '/applicant/resumes') {
          await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: fixtures.resumes,
          });
          return;
        }
        await route.fulfill({ status: 404, body: 'synthetic fixture not found' });
      });
      return context;
    },
  };
}
