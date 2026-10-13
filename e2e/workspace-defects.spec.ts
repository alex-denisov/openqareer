import { expect, test, type Page } from '@playwright/test';

/**
 * B140 — the four defects the owner reported on the released shell. Each check
 * asserts the observable outcome in a real browser at both required viewports,
 * because none of them can be proven from static markup: a flash is a timing
 * fact and a collapsed grid gap is a layout fact.
 */

const SESSION_GATE_TEXT = 'Проверяем защищённую сессию';

/** Records every appearance of the gate, so a 30 ms flash cannot slip past. */
async function watchForSessionGate(page: Page): Promise<void> {
  await page.addInitScript((text: string) => {
    const flagged = { seen: false };
    (window as unknown as { __sessionGateSeen: { seen: boolean } }).__sessionGateSeen = flagged;
    const check = () => {
      if (document.body?.textContent?.includes(text)) flagged.seen = true;
    };
    const observer = new MutationObserver(check);
    const start = () => {
      check();
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    if (document.documentElement) start();
    else document.addEventListener('readystatechange', start, { once: true });
  }, SESSION_GATE_TEXT);
}

async function sessionGateWasSeen(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as { __sessionGateSeen?: { seen: boolean } }).__sessionGateSeen?.seen ??
      false,
  );
}

async function stubEmptySession(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/**', async (route) => {
    await route.fulfill({ json: { data: null } });
  });
}

/**
 * The released artifact prerenders the shell, so its start button is on screen
 * before React mounts. Interactivity starts when the app clears `aria-busy`.
 */
async function waitForLiveApp(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/, {
    timeout: 15_000,
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test.describe('B140 workspace shell and intake defects', () => {
  test('a fast session check never flashes the session gate', async ({ page }) => {
    await watchForSessionGate(page);
    await stubEmptySession(page);
    const sessionResolved = page.waitForResponse((response) =>
      response.url().includes('/api/v1/auth/'),
    );

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await sessionResolved;
    await waitForLiveApp(page);
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();

    expect(await sessionGateWasSeen(page)).toBe(false);
  });

  test('a slow session check stays silent, then offers a retry without the «checking» headline', async ({
    page,
  }) => {
    // Владелец 2026-09-20: на старте никакого «проверяем защищённую сессию».
    // Пока ответ идёт — тихая заглушка; через 6 с — только две кнопки и одна
    // строка о долгом ответе. Стаб держит ответ 12 с, чтобы окно было широким.
    await watchForSessionGate(page);
    await page.route('**/api/v1/auth/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      await route.fulfill({ json: { data: null } });
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.career-session-gate')).toBeVisible({ timeout: 4_000 });
    await expect(page.locator('.career-session-gate')).not.toContainText('защищённую сессию');
    await expect(page.getByText('Загрузка дольше обычного.')).toBeVisible({ timeout: 9_000 });
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible({
      timeout: 9_000,
    });
    expect(await sessionGateWasSeen(page)).toBe(false);
  });

  test('the topbar does not repeat the active navigation item', async ({ page }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page.locator('.career-topbar .career-page-name')).toHaveCount(0);
    await expect(page).toHaveTitle(/Старт/);
  });

  test('a platform action opens account access without claiming a connection', async ({ page }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();
    await page.getByTestId('source-opt-linkedin').click();
    await expect(page.locator('.career-account-access')).toBeVisible();
    await expect(page.getByTestId('first-run-wizard')).toBeHidden();
    await expect(page.getByText('Подключено', { exact: true })).toHaveCount(0);
  });
});
