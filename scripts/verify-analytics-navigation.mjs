import { preview } from 'vite';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';

const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__analyticsDocument = crypto.randomUUID();
    localStorage.setItem('oq-analytics-dev', '1');
    localStorage.setItem(
      'oq-consent-analytics',
      JSON.stringify({ ym: true, ga: true, at: new Date().toISOString() }),
    );
  });
  const page = await context.newPage();
  await page.route('https://mc.yandex.ru/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.route('https://www.googletagmanager.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.route('**/api/**', (route) => route.fulfill({ json: { data: null } }));
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
  await page.waitForFunction(() => !document.querySelector('[data-bootstrap-shell]'));
  await page.waitForFunction(() => window.ym?.a?.length > 0);
  const rootDocument = await page.evaluate(() => window.__analyticsDocument);
  expect(await page.evaluate(() => Array.from(window.ym.a[0])[2].webvisor)).toBe(true);
  await page.locator('.ps-nav').getByRole('link', { name: 'Вопросы', exact: true }).click();
  await expect(page).toHaveURL(/\/faq$/u);
  expect(await page.evaluate(() => window.__analyticsDocument)).toBe(rootDocument);
  await page.getByRole('link', { name: 'Калькулятор Country Fit', exact: true }).click();
  await expect(page).toHaveURL(/\/tools\/country-fit$/u);
  await page.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
  await page.waitForFunction(() => !document.querySelector('[data-bootstrap-shell]'));
  await page.waitForFunction(() => window.ym?.a?.length > 0);
  const toolDocument = await page.evaluate(() => window.__analyticsDocument);
  expect(toolDocument).not.toBe(rootDocument);
  expect(await page.evaluate(() => Array.from(window.ym.a[0])[2].webvisor)).toBe(false);
  await page.locator('#cf-income').fill('120000');
  await page
    .getByRole('group', { name: 'Целевая страна работы', exact: true })
    .getByRole('radio', { name: 'ОАЭ', exact: true })
    .check();
  await page.locator('.cf-next').scrollIntoViewIfNeeded();
  await page.locator('.cf-sticky').getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/u);
  await page.waitForFunction(() => !document.querySelector('[data-bootstrap-shell]'));
  expect(await page.evaluate(() => window.__analyticsDocument)).not.toBe(toolDocument);
  expect(await page.evaluate(() => typeof window.ym)).toBe('undefined');
  expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined');
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('openqareer:country-fit-scenario:v1')),
    ),
  ).toEqual({ countryCode: 'AE', grossAnnualIncome: 120000, currency: 'AED' });
  await page.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
  expect(await page.evaluate(() => typeof window.ym)).toBe('undefined');
  console.log(
    'root → FAQ retains document; FAQ → tool restarts with webvisor:false; tool → signup restarts without analytics SDK; sessionStorage target bridge survives',
  );
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
