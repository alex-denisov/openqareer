import { existsSync } from 'node:fs';
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
        await page.waitForFunction(() => document.documentElement.dataset.release !== undefined);
        // Keep the dependency held after entry JS starts, even when its request
        // was discovered by an HTML preload. Pre-JS checks alone miss a fallback gap.
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

for (const path of ['/login', '/signup']) {
  test(`${path} requests auth modules and styles before entry JavaScript executes`, async ({
    page,
  }, testInfo) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entryRequested!: () => void;
    const entryStarted = new Promise<void>((resolve) => {
      entryRequested = resolve;
    });
    const pending: Promise<void>[] = [];
    const requested = new Set<string>();
    const counts = new Map<string, number>();
    expect(existsSync('dist/.vite/manifest.json')).toBe(false);
    page.on('request', (request) => {
      const url = new URL(request.url()).pathname;
      if (
        /\/assets\/(?:(?:AuthPages|landing|auth)-[^/]+\.js|landing-[^/]+\.css|auth-(?!first-paint-)[^/]+\.css)$/u.test(
          url,
        )
      ) {
        counts.set(request.url(), (counts.get(request.url()) ?? 0) + 1);
      }
      if (/\/assets\/AuthPages-[^/]+\.js$/u.test(url)) requested.add('module');
      if (/\/assets\/landing-[^/]+\.js$/u.test(url)) requested.add('landing-proxy');
      if (/\/assets\/auth-[^/]+\.js$/u.test(url)) requested.add('auth-proxy');
      if (/\/assets\/landing-[^/]+\.css$/u.test(url)) requested.add('landing-css');
      if (/\/assets\/auth-(?!first-paint-)[^/]+\.css$/u.test(url)) requested.add('auth-css');
    });
    await page.route(/\/assets\/index-[^/]+\.js$/u, async (route) => {
      entryRequested();
      const continuation = held.then(() => route.continue());
      pending.push(continuation);
      await continuation;
    });
    await page.route('**/api/**', (route) => route.fulfill({ json: { data: null } }));
    try {
      await page.goto(path, { waitUntil: 'commit' });
      await entryStarted;
      await expect(page.locator('html')).not.toHaveAttribute('data-release');
      await expect
        .poll(() => [...requested].sort())
        .toEqual(['auth-css', 'auth-proxy', 'landing-css', 'landing-proxy', 'module']);
      await expect(page.locator('.auth-card h1')).toBeVisible();
      await expect(page.locator('.auth-card')).toHaveAttribute('inert', '');
      await expect(page.locator('input:enabled')).toHaveCount(0);
      await expect(page.locator('button[type="submit"]')).toBeDisabled();
    } finally {
      release();
      await Promise.all(pending);
    }
    await expect(
      page.locator(path === '/login' ? '#login-identifier' : '#signup-email'),
    ).toBeEditable();
    expect([...counts.values()]).toEqual([1, 1, 1, 1, 1]);
    const resources = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name),
    );
    for (const url of counts.keys())
      expect(resources.filter((resource) => resource === url)).toHaveLength(1);
    await testInfo.attach('early-auth-resources', {
      body: JSON.stringify([...counts.keys()], null, 2),
      contentType: 'application/json',
    });
  });
}
