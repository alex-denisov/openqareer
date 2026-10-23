import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const out = 'output/b350';
const candidate = {
  username: 'candidate.country-fit',
  email: 'country-fit@example.test',
  displayName: 'Country Fit Fixture',
  role: 'candidate',
  isTest: true,
  emailVerified: true,
  candidateId: 'candidate-country-fit',
};
await mkdir(out, { recursive: true });
const document = await readFile('dist/country-fit.html', 'utf8');
expect(document).toContain('https://openqareer.com/tools/country-fit');
expect(document).toContain('<title>Калькулятор налогов');
expect(document).toContain('FAQPage');
const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    let authenticated = false;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/auth/me')
        return route.fulfill({ json: { data: authenticated ? candidate : null } });
      if (path === '/api/v1/candidate/connections') return route.fulfill({ json: { data: [] } });
      if (path === '/api/v1/desktop/macos')
        return route.fulfill({ json: { data: { available: false } } });
      return route.fulfill({ json: { data: null } });
    });
    await page.goto(`${base}/tools/country-fit`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Зарплата после налогов');
    const firstNet = await page.locator('.cf-net').boundingBox();
    expect(firstNet.y + firstNet.height).toBeLessThanOrEqual(width === 390 ? 844 : 900);
    await page.locator('#cf-income').fill('120000');
    await page.getByRole('radio', { name: 'ОАЭ', exact: true }).check();
    await expect(page.locator('.cf-net')).toContainText('10');
    for (const [index, value] of ['3000', '500', '1500'].entries())
      await page.locator(`#cf-cost-${index}`).fill(value);
    await expect(page.locator('.cf-remainder')).toContainText('5');
    await page.locator('#cf-income').fill('-1');
    await expect(page.getByRole('alert')).toContainText('Введите годовой доход');
    await expect(page.getByRole('button', { name: 'Продолжить с этим сценарием' })).toBeDisabled();
    await page.locator('#cf-income').fill('120000');
    await page.getByText('Откуда взяты расходы на жизнь?', { exact: true }).click();
    await expect(page.locator('details[open]')).toContainText('Это личный сценарий');
    await page.locator('#cf-income').focus();
    expect(
      await page.locator('#cf-income').evaluate((input) => getComputedStyle(input).outlineStyle),
    ).not.toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
    expect(
      accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact)),
    ).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${out}/country-fit-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Продолжить с этим сценарием' }).click();
    await expect(page).toHaveURL(/\/signup$/u);
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem('openqareer:country-fit-scenario:v1')),
      ),
    ).toEqual({ countryCode: 'AE', grossAnnualIncome: 120000, currency: 'AED' });
    authenticated = true;
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();
    await page.getByTestId('goal-textarea').fill('Найти работу в выбранной стране');
    await page.getByTestId('save-goal-btn').click();
    if (width === 390) {
      await page.getByTestId('source-skip-btn').click();
      await page.getByTestId('skip-confirm-btn').click();
    } else {
      await page.getByTestId('source-opt-talk').click();
    }
    await expect(
      page.getByText(/Сценарий Country Fit: AE, годовая зарплата до налогов 120000 AED/u),
    ).toBeVisible();
    await page.screenshot({ path: `${out}/onboarding-${width}.png`, fullPage: true });
    await expect(page.getByTestId('context-relocation-checkbox')).not.toBeChecked();
    await page.getByTestId('context-submit-btn').click();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('openqareer:country-fit-scenario:v1')))
      .toBeNull();
    const savedWorkspace = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('candidate-workspace')),
    );
    expect(savedWorkspace.constraints).toContain(
      'Сценарий Country Fit: ОАЭ, годовая зарплата до налогов 120000 AED',
    );
    expect(savedWorkspace.constraints).not.toContain('Готов к релокации');
    await page.goto(`${base}/tools/country-fit`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Открыть кабинет', exact: true })).toBeVisible();
    await page.evaluate(() => sessionStorage.removeItem('openqareer:country-fit-scenario:v1'));
    await page.getByRole('button', { name: 'Открыть кабинет', exact: true }).click();
    expect(
      await page.evaluate(() => sessionStorage.getItem('openqareer:country-fit-scenario:v1')),
    ).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
    console.log(
      `${width}: payroll, budget, invalid/disabled, FAQ, focus, overflow, signup bridge and onboarding context passed`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
