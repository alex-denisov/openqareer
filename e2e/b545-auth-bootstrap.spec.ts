import { expect, test } from '@playwright/test';

for (const path of ['/login', '/signup']) {
  for (const dependency of ['module', 'stylesheet']) {
    test(`${path} keeps its inert form while the auth ${dependency} loads after entry startup`, async ({
      page,
    }, testInfo) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requested!: () => void;
      const started = new Promise<void>((resolve) => {
        requested = resolve;
      });
      const asset =
        dependency === 'module'
          ? /\/assets\/AuthPages-[^/]+\.js$/u
          : /\/assets\/auth-(?!first-paint-)[^/]+\.css$/u;
      let initialAppearance: { background: string; font: string } | undefined;
      const pendingAssets: Promise<void>[] = [];
      const brokenAssets: string[] = [];
      const fontRequests: string[] = [];
      page.on('request', (request) => {
        if (/\.woff2(?:\?|$)/u.test(request.url())) fontRequests.push(request.url());
      });
      page.on('response', (response) => {
        if (/\.(?:css|woff2)(?:\?|$)/u.test(response.url()) && response.status() >= 400)
          brokenAssets.push(response.url());
      });
      page.on('requestfailed', (request) => {
        if (/\.(?:css|woff2)(?:\?|$)/u.test(request.url())) brokenAssets.push(request.url());
      });
      await page.addInitScript(() => {
        const blankFrames: number[] = [];
        Reflect.set(window, '__b545BlankFrames', blankFrames);
        let sawForm = false;
        const sample = () => {
          const card = document.querySelector<HTMLElement>('.auth-card');
          if (card) sawForm = true;
          if (sawForm && !card) blankFrames.push(performance.now());
          if (!card || card.inert) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.route('**/api/**', (route) => route.fulfill({ json: { data: null } }));
      await page.route(asset, async (route) => {
        requested();
        const continuation = held.then(() => route.continue());
        pendingAssets.push(continuation);
        await continuation;
      });
      try {
        await page.goto(path, { waitUntil: 'commit' });
        await started;
        // This request is initiated by entry JS. Checking only before JS would
        // miss createRoot replacing the form with an empty Suspense fallback.
        // The disabled bootstrap card is deliberately excluded from the accessibility tree.
        const title = page.locator('.auth-card h1');
        await expect(title).toBeVisible();
        initialAppearance = await page.locator('.auth-card').evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          font: getComputedStyle(element).fontFamily,
        }));
        await expect(page.getByRole('status')).toHaveText('Загружаем форму…');
        await expect(page.locator('.auth-card')).toHaveAttribute('inert', '');
        await expect(page.locator('input:enabled')).toHaveCount(0);
        await expect(page.locator('button[type="submit"]')).toBeDisabled();
        await expect(page.locator('input').first()).toHaveAttribute('autocomplete', 'off');
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await expect(title).toBeVisible();
        await expect(page.locator('.auth-card')).toHaveAttribute('inert', '');
        await expect.poll(() => fontRequests.length).toBeGreaterThan(0);
        await page.screenshot({ path: testInfo.outputPath('auth-pending.png'), fullPage: true });
      } finally {
        release();
        await Promise.all(pendingAssets);
      }
      const identity = page.locator(path === '/login' ? '#login-identifier' : '#signup-email');
      await expect(identity).toBeEditable();
      await expect(page.locator('.auth-card')).not.toHaveAttribute('inert');
      await expect(page.getByRole('status')).toHaveCount(0);
      await identity.fill('synthetic@example.com');
      await expect(identity).toHaveValue('synthetic@example.com');
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.locator('.auth-card').evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          font: getComputedStyle(element).fontFamily,
        })),
      ).toEqual(initialAppearance);
      expect(await page.evaluate(() => Reflect.get(window, '__b545BlankFrames'))).toEqual([]);
      expect(brokenAssets).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    });
  }
}
