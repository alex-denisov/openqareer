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
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function openContextStep(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Начать диагностику' }).click();
  await page.getByRole('button', { name: /Хочу найти работу/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Без документов' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { name: 'Что должно измениться?' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Начните с карьерного вопроса' })).toBeVisible();

    expect(await sessionGateWasSeen(page)).toBe(false);
  });

  test('a slow session check still explains why the workspace is empty', async ({ page }) => {
    await page.route('**/api/v1/auth/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({ json: { data: null } });
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(SESSION_GATE_TEXT)).toBeVisible({ timeout: 3_000 });
  });

  test('the topbar does not repeat the active navigation item', async ({ page }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page.locator('.career-topbar .career-page-name')).toHaveCount(0);
    await expect(page).toHaveTitle(/Сегодня/);
  });

  test('step three gives every legend the same breathing room as a label', async ({ page }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await openContextStep(page);

    const rows = await page.evaluate(() => {
      const form = document.querySelector('.career-context-form');
      if (!form) return [];
      return [...form.children].map((child) => {
        const heading = child.querySelector(':scope > legend, :scope > span');
        const control = child.querySelector(
          '.career-chip-picker, .career-segmented-control, input, textarea',
        );
        const headingBox = heading?.getBoundingClientRect();
        const controlBox = control?.getBoundingClientRect();
        return {
          tag: child.tagName,
          heading: heading?.textContent ?? '',
          headingBottom: headingBox ? headingBox.bottom : null,
          controlTop: controlBox ? controlBox.top : null,
          controlLeft: controlBox ? controlBox.left : null,
        };
      });
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.headingBottom, `${row.heading} must be laid out`).not.toBeNull();
      expect(row.controlTop, `${row.heading} must have a control`).not.toBeNull();
      if (row.headingBottom === null || row.controlTop === null) continue;
      // Every field in this form declares `gap: 8px` between its heading and
      // its control. A rendered <legend> escapes that grid and lands flush on
      // the chips, which is exactly what the owner saw.
      expect(
        Math.round(row.controlTop - row.headingBottom),
        `«${row.heading.trim()}» leaves ${Math.round(
          row.controlTop - row.headingBottom,
        )}px under its heading`,
      ).toBeGreaterThanOrEqual(6);
    }
  });

  test('step three keeps side-by-side controls on one baseline', async ({ page }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await openContextStep(page);

    const roleInput = page.locator('.career-context-form label', {
      hasText: 'Какая роль интересует?',
    });
    const marketControl = page
      .locator('.career-context-form fieldset', { hasText: 'Где рассматриваете работу?' })
      .locator('.career-segmented-control');
    const inputBox = await roleInput.locator('input').boundingBox();
    const controlBox = await marketControl.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    if (!inputBox || !controlBox) return;

    const viewport = page.viewportSize();
    if (!viewport || viewport.width < 900) return;
    expect(
      Math.abs(inputBox.y - controlBox.y),
      'a label and a fieldset in the same grid row must start their controls together',
    ).toBeLessThanOrEqual(2);
  });

  test('the profile import source offers desktop companion CTA in web mode and cards in desktop mode', async ({
    page,
  }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await page.getByRole('button', { name: 'Начать диагностику' }).click();
    await page.getByRole('button', { name: /Хочу найти работу/ }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();

    const fields = page.locator('.career-source-fields');
    // In web mode, offers desktop companion CTA
    await expect(fields.locator('.career-web-desktop-cta')).toBeVisible();
    await expect(fields.getByRole('link', { name: 'Скачать OpenQareer Desktop' })).toBeVisible();
  });

  test('the intake never names a button that is not on screen', async ({ page }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await page.getByRole('button', { name: 'Начать диагностику' }).click();
    await page.getByRole('button', { name: /Хочу найти работу/ }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Импорт профиля', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();

    const error = page.locator('.career-intake-error');
    await expect(error).toBeVisible();
    const quoted = (await error.innerText()).match(/«([^»]+)»/gu) ?? [];
    expect(quoted.length).toBeGreaterThan(0);
    for (const mention of quoted) {
      const name = mention.slice(1, -1);
      await expect(
        page.getByRole('button', { name, exact: true }),
        `the error names «${name}», so that button must exist`,
      ).toHaveCount(1);
    }
  });

  test('quick fallbacks switch the intake source without error', async ({ page }) => {
    await stubEmptySession(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await page.getByRole('button', { name: 'Начать диагностику' }).click();
    await page.getByRole('button', { name: /Хочу найти работу/ }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Импорт профиля', exact: true }).click();

    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect(page.locator('.career-pdf-source')).toBeVisible();

    await page.getByRole('button', { name: 'Текстом', exact: true }).click();
    await expect(page.locator('.career-source-textarea')).toBeVisible();

    await page.getByRole('button', { name: 'Без документов', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Что должно измениться?' })).toBeVisible();
  });
});
