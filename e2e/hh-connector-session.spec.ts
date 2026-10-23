import { expect, test, type Page } from '@playwright/test';
import { installDesktopApiTestBridge } from '../scripts/desktop-api-test-bridge.mjs';
import { chooseFirstRunPlatform, saveFirstRunGoal } from './helpers/firstRunGoal';

/**
 * B157, owner report 2026-08-26 — «Импортировать выбранное резюме не удалось».
 *
 * The account had more than one resume, so the dialog closed and handed the
 * list to the wizard while its native sign-in window stayed on screen with
 * nothing left that owned it. The candidate closed that window by hand, and the
 * import then read through a window that was gone.
 *
 * Only a browser can prove the fix: the defect is a lifetime, not a rendering.
 * hh.ru itself is replaced by a stubbed desktop bridge — no platform account
 * and no credentials take part in this gate.
 */

const CANDIDATE = {
  username: 'connector.candidate',
  email: 'connector.candidate@example.com',
  displayName: 'Кандидат',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b157',
};

const RESUME_LIST_BODY = `<main>
  <a data-qa="resume-title" href="/resume/resume-alpha">Руководитель продукта</a>
  <a data-qa="resume-title" href="/resume/resume-beta">Директор по продукту</a>
</main>`;

const RESUME_DETAIL_BODY = `<main>
  <div data-qa="resume-block-title-position">Директор по продукту</div>
  <div data-qa="resume-block-skills">Управление продуктом</div>
</main>`;

interface BridgeOptions {
  /** How many resume reads answer `session_window_missing` before succeeding. */
  readonly missingWindowReads?: number;
  /** Keep a cancellation test on the provider login page. */
  readonly waitingForSignIn?: boolean;
}

/**
 * A desktop bridge whose whole job is to be honest about the one thing under
 * test: whether a sign-in window exists when the chosen resume is read.
 */
async function stubDesktopBridge(page: Page, options: BridgeOptions = {}): Promise<void> {
  await page.addInitScript(installDesktopApiTestBridge);
  await page.addInitScript(
    ({ listBody, detailBody, missingWindowReads, waitingForSignIn }) => {
      localStorage.setItem('openqareer_session_token', 'desktop-e2e-session');
      const calls: string[] = [];
      let sessionOpen = false;
      let missingLeft = missingWindowReads;
      (window as unknown as { __connectorCalls: string[] }).__connectorCalls = calls;
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {
          invoke: (command: string, args: Record<string, unknown>) => {
            calls.push(command);
            if (command === 'probe_network_status') {
              return Promise.resolve({
                linkedin: { platform: 'linkedin', target_url: '', accessible: true },
                hh: { platform: 'hh', target_url: '', accessible: true },
                recommendation: 'direct',
                local_ip_region_hint: 'test',
                probed_at: new Date().toISOString(),
              });
            }
            if (command === 'open_connector_session') {
              sessionOpen = true;
              return Promise.resolve({ opened: true, label: 'connector-hh', reason: null });
            }
            if (command === 'show_connector_session' || command === 'is_connector_session_open')
              return Promise.resolve(sessionOpen);
            if (command === 'close_connector_session' || command === 'reset_connector_session') {
              sessionOpen = false;
              return Promise.resolve(true);
            }
            if (command === 'resize_connector_session') return Promise.resolve(true);
            if (command === 'inspect_connector_session_page') {
              if (!sessionOpen) return Promise.reject('session_window_missing');
              return Promise.resolve({
                ready: true,
                url: 'https://hh.ru/applicant/resumes',
                signedInApplicant: !waitingForSignIn,
                login: waitingForSignIn,
                otp: false,
                captcha: false,
              });
            }
            if (command === 'read_connector_session_page') {
              const request = args.request as { url: string };
              const list = request.url.includes('/applicant/resumes');
              if (!list && missingLeft > 0) {
                missingLeft -= 1;
                sessionOpen = false;
                return Promise.reject('session_window_missing');
              }
              if (!sessionOpen) return Promise.reject('session_window_missing');
              return Promise.resolve({
                ok: true,
                url: request.url,
                body: list ? listBody : detailBody,
              });
            }
            return Promise.resolve(null);
          },
        };
    },
    {
      listBody: RESUME_LIST_BODY,
      detailBody: RESUME_DETAIL_BODY,
      missingWindowReads: options.missingWindowReads ?? 0,
      waitingForSignIn: options.waitingForSignIn ?? false,
    },
  );
}

async function stubCandidateApi(page: Page): Promise<void> {
  let hhStatus: 'disconnected' | 'connected' = 'disconnected';
  await page.route('**/api/v1/account/email-change-requests/current', (route) =>
    route.fulfill({ json: { data: null } }),
  );
  await page.route('**/api/v1/me/consents', (route) =>
    route.fulfill({ json: { data: { consents: [] } } }),
  );
  await page.route('**/api/v1/candidate/**', async (route) => {
    await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({ json: { data: CANDIDATE } });
  });
  await page.route('**/api/v1/candidate/connections', async (route) => {
    const hh = {
      platform: 'hh',
      available: true,
      capabilities: ['resume_read'],
      importsCareerHistory: true,
      status: hhStatus,
      ...(hhStatus === 'connected'
        ? {
            accessMode: 'native_session_snapshot',
            connectedAt: new Date().toISOString(),
            lastImportedAt: new Date().toISOString(),
            factCount: 4,
          }
        : {}),
    };
    const linkedin = {
      platform: 'linkedin',
      available: true,
      capabilities: ['profile_read'],
      importsCareerHistory: true,
      status: 'disconnected',
    };
    await route.fulfill({ json: { data: [linkedin, hh] } });
  });
  await page.route('**/api/v1/account', async (route) => {
    await route.fulfill({
      json: {
        data: {
          username: CANDIDATE.username,
          email: CANDIDATE.email,
          displayName: CANDIDATE.displayName,
          profile: { headline: '', location: '', workMode: 'hybrid' },
          sessions: [],
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/resume/import', async (route) => {
    hhStatus = 'connected';
    const now = new Date().toISOString();
    await route.fulfill({
      json: {
        data: {
          parsed: {
            targetRole: 'Директор по продукту',
            contact: {},
            experience: [],
            skills: ['Управление продуктом'],
            education: [],
            courses: [],
            tests: [],
            recommendations: [],
            languages: [],
            rawText: 'Директор по продукту',
          },
          resume: null,
          structuredBy: 'rules',
          factCount: 4,
          connection: {
            platform: 'hh',
            available: true,
            status: 'connected',
            accessMode: 'native_session_snapshot',
            capabilities: ['resume_read'],
            importsCareerHistory: true,
            connectedAt: now,
            lastImportedAt: now,
            factCount: 4,
          },
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/workspace', async (route) => {
    await route.fulfill({ json: { data: null } });
  });
}

async function openHhDialog(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();
  await saveFirstRunGoal(page);
  await chooseFirstRunPlatform(page, 'hh');
  const connectionRow = accountHhRow(page);
  await expect(connectionRow).toContainText('Не подключено');
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await connectionRow.click();
  } else {
    await connectionRow.getByRole('button', { name: 'Подключить' }).click();
  }
}

function accountHhRow(page: Page) {
  return (page.viewportSize()?.width ?? 1440) <= 760
    ? page.getByRole('button', { name: /^hh\.ru/ })
    : page
        .getByRole('tabpanel', { name: /Подключения/ })
        .locator('.career-account-row')
        .filter({ hasText: 'hh.ru' });
}

test.describe('B157 the hh.ru dialog owns its sign-in window', () => {
  test('the resume choice is made inside the dialog and the import finishes there', async ({
    page,
  }) => {
    await stubDesktopBridge(page);
    await stubCandidateApi(page);
    await openHhDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Подключение hh.ru' });
    await expect(dialog).toBeVisible();
    const showWindow = dialog.getByRole('button', { name: 'Показать окно', exact: true });
    await expect(showWindow).toBeVisible();
    await showWindow.click();

    // The picker lives here, next to the session that answers it — never in the
    // wizard behind the dialog (owner report, 2026-08-26).
    const picker = dialog.getByLabel('Выберите резюме для импорта');
    await expect(picker).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /^(Аккаунт|Подключения)$/ }).last(),
    ).toBeVisible();

    await picker.selectOption({ label: 'Директор по продукту' });
    await dialog.getByRole('button', { name: 'Импортировать выбранное резюме' }).click();

    // The dialog closes only once the profile really holds the resume, and the
    // sign-in window goes with it.
    await expect(dialog).toHaveCount(0);
    const row = accountHhRow(page);
    await expect(row.getByText('Подключено', { exact: true })).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) > 760) {
      await expect(row.getByRole('button', { name: 'Управлять' })).toBeVisible();
    }

    const calls = await page.evaluate(
      () => (window as unknown as { __connectorCalls: string[] }).__connectorCalls,
    );
    expect(calls).toContain('close_connector_session');
    expect(calls).toContain('show_connector_session');
  });

  test('the session toolbar cancels and closes the native window', async ({ page }) => {
    await stubDesktopBridge(page, { waitingForSignIn: true });
    await stubCandidateApi(page);
    await openHhDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Подключение hh.ru' });
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);

    const calls = await page.evaluate(
      () => (window as unknown as { __connectorCalls: string[] }).__connectorCalls,
    );
    expect(calls).toContain('close_connector_session');
  });

  test('a window the candidate closed mid-choice is reopened instead of blamed', async ({
    page,
  }) => {
    await stubDesktopBridge(page, { missingWindowReads: 1 });
    await stubCandidateApi(page);
    await openHhDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Подключение hh.ru' });
    await expect(dialog.getByLabel('Выберите резюме для импорта')).toBeVisible();
    await dialog.getByRole('button', { name: 'Импортировать выбранное резюме' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(accountHhRow(page).getByText('Подключено', { exact: true })).toBeVisible();
    // No dead end, and no sentence blaming the resume for a missing window.
    await expect(page.getByText('Импортировать выбранное резюме не удалось')).toHaveCount(0);
  });
});
