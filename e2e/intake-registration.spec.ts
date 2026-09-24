import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type Page } from '@playwright/test';
import { installDesktopApiTestBridge } from '../scripts/desktop-api-test-bridge.mjs';

/**
 * B141 — the owner reached step «Что уже есть?», chose hh.ru, registered the
 * account that step demands, and landed in the cabinet with the diagnostic
 * gone. Only a real browser can prove this: the defect is a remount caused by
 * a session arriving mid-wizard, and static markup never sees that transition.
 */

const REGISTERED_CANDIDATE = {
  username: 'diagnostic.candidate',
  email: 'diagnostic.candidate@example.com',
  displayName: 'Диагностика',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b141',
};

/**
 * The wizard starts anonymous and the account appears only when the candidate
 * registers, so the session endpoint answers from a flag this stub owns rather
 * than from a fixed body.
 */
async function stubAuth(page: Page): Promise<void> {
  let registered = false;

  await page.route('**/api/v1/auth/register', async (route) => {
    registered = true;
    await route.fulfill({ json: { data: REGISTERED_CANDIDATE } });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({ json: { data: registered ? REGISTERED_CANDIDATE : null } });
  });
  // Candidate and coach endpoints are deliberately left unstubbed: they fail
  // against the static preview exactly as the other specs let them, and the
  // cabinet's own empty state is what these assertions read. Answering them
  // with `{ data: null }` blanks the whole tree instead — a separate defect,
  // recorded as INC-020, not something this spec should paper over.
}

async function waitForLiveApp(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

/**
 * Walks the wizard to the source step (the wizard's first screen since B249)
 * and asks for the Profile Import path via the LinkedIn card — LinkedIn and
 * hh.ru still share `profile-import` underneath (`intakeSourceLock`), so
 * either card lands on the same platform-cards screen.
 */
async function reachProfileImportSourceStep(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'С чем разбираемся?' })).toBeVisible();
  await page.getByRole('button', { name: 'Профиль LinkedIn' }).click();
}

async function registerFromTopBar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Открыть аккаунт' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Аккаунт' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Создать аккаунт' }).click();
  await dialog.getByLabel('Как к вам обращаться').fill(REGISTERED_CANDIDATE.displayName);
  await dialog.getByLabel('Email').fill(REGISTERED_CANDIDATE.email);
  await dialog.getByLabel('Пароль').fill('diagnostic-passphrase-2026');
  // B173: registration refuses to proceed until the published pack is accepted.
  await dialog.getByRole('button', { name: 'Создать и начать' }).click();
  await expect(dialog.getByText('Примите пользовательское соглашение')).toBeVisible();
  await dialog.locator('#account-legal-consent').check();
  await dialog.getByRole('button', { name: 'Создать и начать' }).click();
}

test.describe('B141 diagnostic survives registration', () => {
  test('registering inside the wizard returns to the same step, not the cabinet', async ({
    page,
  }) => {
    await stubAuth(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await reachProfileImportSourceStep(page);
    await registerFromTopBar(page);

    // The account panel closes itself after a successful registration, and the
    // candidate must be looking at the step they left — not at the cabinet.
    await expect(page.getByRole('dialog', { name: 'Аккаунт' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'С чем разбираемся?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Карьерный кабинет' })).toHaveCount(0);
  });

  test('the profile import option shows desktop companion CTA in web mode', async ({ page }) => {
    await stubAuth(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await reachProfileImportSourceStep(page);
    const fields = page.locator('.career-source-fields');

    await expect(fields.locator('.career-web-desktop-cta')).toBeVisible();
    await expect(
      fields.getByText('Публичной загрузки приложения пока нет', { exact: false }),
    ).toBeVisible();
    await expect(fields.getByRole('link')).toHaveCount(0);
  });

  test('the profile import option shows platform cards in desktop mode', async ({ page }) => {
    await page.addInitScript(installDesktopApiTestBridge);
    await page.addInitScript(() => {
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {};
      localStorage.setItem('openqareer_session_token', 'desktop-e2e-session');
    });
    await stubAuth(page);
    // The native companion is a protected workspace. Its platform connectors
    // must be exercised from an authenticated desktop session; an anonymous
    // `/app` now correctly returns to `/login` instead of exposing a dead
    // connector whose bootstrap can only answer 401 (B147).
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ json: { data: REGISTERED_CANDIDATE } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await reachProfileImportSourceStep(page);
    const fields = page.locator('.career-source-fields');

    await expect(fields.locator('.career-platform-cards')).toBeVisible();
    await expect(fields.getByRole('button', { name: 'Подключить' })).toHaveCount(2);
  });

  test('an expired desktop session returns to login before a connector can start', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {};
    });
    await stubAuth(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Вход в кабинет' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Подключить' })).toHaveCount(0);
  });

  test('a refused step shows why on screen instead of below the action bar', async ({ page }) => {
    await stubAuth(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await reachProfileImportSourceStep(page);
    // The link is deliberately left empty: the wizard must refuse, and the
    // refusal must be readable. On mobile the action bar is sticky, so an
    // explanation rendered above it is off screen and «Продолжить» looks dead.
    await page.getByRole('button', { name: 'Продолжить' }).click();

    const explanation = page.locator('.career-intake-error');
    await expect(explanation).toBeVisible();
    const occluded = await explanation.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !(hit === element || element.contains(hit));
    });
    expect(occluded, 'the refusal must not sit under the action bar').toBe(false);
  });

  test('a signed-in candidate without a workspace opens the diagnostic wizard', async ({
    page,
  }) => {
    await stubAuth(page);
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ json: { data: REGISTERED_CANDIDATE } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page.getByRole('heading', { name: 'С чем разбираемся?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF резюме' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Карьерный кабинет' })).toHaveCount(0);
  });
});

test.describe('B229 desktop session recovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installDesktopApiTestBridge);
    await page.addInitScript(() => {
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {};
      if (!localStorage.getItem('openqareer_session_token')) {
        localStorage.setItem('openqareer_session_token', 'desktop-restored-session');
      }
    });
    await page.route('**/api/v1/candidate/workspace', (route) =>
      route.fulfill({ json: { data: null } }),
    );
  });

  test('restores a session taking more than two seconds, including after reload', async ({
    page,
  }) => {
    let reads = 0;
    await page.route('**/api/v1/auth/me', async (route) => {
      reads++;
      // Deliberate server latency exercises the former two-second abort.
      await delay(2_500);
      await route.fulfill({ json: { data: REGISTERED_CANDIDATE } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    for (const reload of [false, true]) {
      if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'С чем разбираемся?' })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole('button', { name: 'Открыть аккаунт' }).first()).toBeEnabled();
      await expect(page.getByText('Не удалось проверить аккаунт.', { exact: false })).toHaveCount(
        0,
      );
      await expect(page.getByRole('heading', { name: 'Вход в кабинет' })).toHaveCount(0);
      await expect(page).toHaveURL(/\/app$/);
    }
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => localStorage.getItem('openqareer_session_token'))).toBe(
      'desktop-restored-session',
    );
  });

  test('a delayed old session cannot replace a newly signed-in account', async ({ page }) => {
    const nextCandidate = {
      ...REGISTERED_CANDIDATE,
      candidateId: 'candidate-b229-next',
      displayName: 'Новый кандидат',
      email: 'next@example.test',
    };
    let signedIn = false;
    let holdOldRead = false;
    let releaseOldRead!: () => void;
    let reportOldRead!: () => void;
    const oldReadStarted = new Promise<void>((resolve) => {
      reportOldRead = resolve;
    });
    const oldReadGate = new Promise<void>((resolve) => {
      releaseOldRead = resolve;
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      const data = signedIn ? nextCandidate : REGISTERED_CANDIDATE;
      if (holdOldRead && !signedIn) {
        reportOldRead();
        await oldReadGate;
      }
      await route.fulfill({ json: { data } });
    });
    await page.route('**/api/v1/auth/login', async (route) => {
      signedIn = true;
      await route.fulfill({
        json: { data: { ...nextCandidate, sessionToken: 'desktop-next-session' } },
      });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'С чем разбираемся?' })).toBeVisible();
    holdOldRead = true;
    // Simulate navigation while a restore still carries the old bearer token.
    await page.evaluate(() => {
      history.pushState(null, '', '/login');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await oldReadStarted;
    await page.getByLabel('Email или логин').fill(nextCandidate.email);
    await page.getByLabel('Пароль', { exact: true }).fill('synthetic-passphrase-2026');
    await page.getByRole('button', { name: 'Войти в кабинет' }).click();
    await expect(page).toHaveURL(/\/app$/);
    // Narrow viewports print initials («НК») instead of the full name;
    // both differ from the old account's «Диагностика» / «Д».
    const newAccount = /Новый кандидат|^НК$/u;
    await expect(page.getByRole('button', { name: 'Открыть аккаунт' }).first()).toHaveText(
      newAccount,
    );
    const staleResponse = page.waitForResponse('**/api/v1/auth/me');
    releaseOldRead();
    await (await staleResponse).finished();
    await waitForLiveApp(page);
    await expect(page.getByRole('button', { name: 'Открыть аккаунт' }).first()).toHaveText(
      newAccount,
    );
    expect(await page.evaluate(() => localStorage.getItem('openqareer_session_token'))).toBe(
      'desktop-next-session',
    );
  });
});
