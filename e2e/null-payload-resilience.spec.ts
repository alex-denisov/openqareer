import { expect, test } from '@playwright/test';

// INC-020: an unexpected `{"data": null}` from any signed-in API surface must
// degrade into an explainable state, never a blank <body>. The cabinet hook
// validates its inputs and the shell is wrapped in error boundaries, so the
// candidate always sees either the workspace or the boundary card.
test.describe('cabinet survives unexpected null API payloads', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            username: 'candidate.test',
            role: 'candidate',
            isTest: true,
            candidateId: 'candidate-null-regression',
          },
        }),
      });
    });
    await page.route('**/api/v1/account', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      });
    });
    await page.route('**/api/v1/candidate/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      });
    });
    await page.route('**/api/v1/coach/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      });
    });
  });

  test('signed-in workspace stays readable when every reading returns null', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/app?inc020-null-payloads', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('career-shell')).toBeVisible();

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length).toBeGreaterThan(0);
    // B249: a candidate answering `{ "data": null }` on `/candidate/workspace`
    // has no workspace, so the shell correctly opens the fullscreen
    // diagnostic wizard (rail included) instead of the cabinet — that is the
    // navigable, non-broken state INC-020 asks for here.
    await expect(page.getByRole('heading', { name: 'С чем разбираемся?' })).toBeVisible();
    expect(pageErrors).toEqual([]);

    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy');
  });
});
