import { expect, test, type Page } from '@playwright/test';

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

/** Walks the wizard to the source step and asks for the Profile Import path. */
async function reachProfileImportSourceStep(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Начать диагностику' }).click();
  await page.getByRole('button', { name: /Хочу найти работу/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { name: 'Что уже есть?' })).toBeVisible();
  await page.getByRole('button', { name: 'Импорт профиля', exact: true }).click();
}

async function registerFromTopBar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Открыть аккаунт' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Аккаунт' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Создать аккаунт' }).click();
  await dialog.getByLabel('Как к вам обращаться').fill(REGISTERED_CANDIDATE.displayName);
  await dialog.getByLabel('Email').fill(REGISTERED_CANDIDATE.email);
  await dialog.getByLabel('Пароль').fill('diagnostic-passphrase-2026');
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
    await expect(page.getByRole('heading', { name: 'Что уже есть?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Карьерный кабинет' })).toHaveCount(0);
  });

  test('the profile import card has connect action and connector selector', async ({ page }) => {
    await stubAuth(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await reachProfileImportSourceStep(page);
    const fields = page.locator('.career-source-fields');

    // Profile import stays selected and connector select & connect button are available
    await expect(page.getByRole('button', { name: 'Импорт профиля', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(fields.getByRole('button', { name: 'Подключить' })).toBeVisible();
    await expect(fields.getByRole('combobox')).toBeVisible();
    await expect(fields.getByRole('textbox')).toBeVisible();
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

    await expect(page.getByRole('heading', { name: 'Начните с карьерного вопроса' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начать диагностику' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Карьерный кабинет' })).toHaveCount(0);
  });
});
