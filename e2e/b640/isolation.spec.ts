import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { candidate } from '../fixtures/readabilityWorkspace';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

const flagged = { ...candidate, features: { cabinetB640: true } };

/** Загружен ли в документ прежний career-shell.css: он приходит отдельным файлом сборки. */
function oldShellCssLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.styleSheets].some((sheet) => /\/career-shell-[\w-]+\.css/u.test(sheet.href ?? '')),
  );
}

async function openKit(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.history.pushState(null, '', '/app/kit');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('[data-b640-kit]')).toBeVisible();
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
}

async function signInThroughForm(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  let signedIn = false;
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { data: signedIn ? flagged : null } }),
  );
  await page.route('**/api/v1/auth/login', (route) => {
    signedIn = true;
    return route.fulfill({
      json: { data: { ...flagged, sessionToken: 'synthetic-b649-session' } },
    });
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email или логин').fill(candidate.username);
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password-for-e2e');
  // Фокус в форме заранее подгружает прежнюю оболочку: флаг ещё неизвестен.
  await expect.poll(() => oldShellCssLoaded(page), { timeout: 15_000 }).toBe(true);
  await page.getByRole('button', { name: 'Войти в кабинет' }).click();
}

test.describe('B649: новый кабинет изолирован от прежнего', () => {
  test('вход формой на аккаунте с флагом открывает новый корень', async ({ page }) => {
    await signInThroughForm(page);
    await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('career-shell')).toHaveCount(0);
    await expect(page).toHaveURL(/\/app/u);
    expect(
      await page.evaluate(() => window.localStorage.getItem('oq_cabinet_b640')),
      'флаг запомнен для первого кадра',
    ).toBe('1');
  });

  test('снимок при загруженном прежнем career-shell.css совпадает со снимком без него', async ({
    page,
    browser,
  }, testInfo) => {
    await signInThroughForm(page);
    await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
    await openKit(page);
    expect(await oldShellCssLoaded(page), 'прежние стили в документе').toBe(true);
    const withOldCss = await page.screenshot({ fullPage: true });

    const context = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
      reducedMotion: 'reduce',
      baseURL: testInfo.project.use.baseURL,
    });
    const clean = await context.newPage();
    await mockSignedInCabinet(clean, { cabinetB640: true });
    // Устройство, где новый кабинет уже открывался: прежняя оболочка не грузится вовсе.
    await clean.addInitScript(() => window.localStorage.setItem('oq_cabinet_b640', '1'));
    await clean.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(clean.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
    await openKit(clean);
    expect(await oldShellCssLoaded(clean), 'прежних стилей в документе нет').toBe(false);
    const withoutOldCss = await clean.screenshot({ fullPage: true });
    await context.close();

    // Проверка самой проверки: без границы слоёв прежние стили меняют новый кабинет.
    const removed = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          const rule = rules[index];
          if (rule instanceof CSSStyleRule && rule.selectorText.includes('.b640:not(#')) {
            sheet.deleteRule(index);
            return true;
          }
        }
      }
      return false;
    });
    expect(removed, 'граница слоёв найдена в стилях').toBe(true);
    const withoutBarrier = await page.screenshot({ fullPage: true });
    expect(
      Buffer.compare(withoutBarrier, withOldCss) === 0,
      'без границы прежние стили видны в новом кабинете',
    ).toBe(false);

    const same = Buffer.compare(withOldCss, withoutOldCss) === 0;
    if (!same) {
      mkdirSync(testInfo.outputDir, { recursive: true });
      writeFileSync(testInfo.outputPath('with-old-css.png'), withOldCss);
      writeFileSync(testInfo.outputPath('without-old-css.png'), withoutOldCss);
    }
    expect(same, 'прежние стили не должны менять новый кабинет').toBe(true);
  });

  test('устройство с запомненным флагом видит нейтральный кадр, прежняя оболочка не грузится', async ({
    page,
  }) => {
    await mockSignedInCabinet(page, { cabinetB640: true });
    let release: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await answered;
      await route.fulfill({ json: { data: flagged } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('oq_signed_in', '1');
      window.localStorage.setItem('oq_cabinet_b640', '1');
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('cabinet-b640-boot')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('career-shell')).toHaveCount(0);
    await expect(page.locator('.career-rail')).toHaveCount(0);
    release();
    await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('cabinet-b640-boot')).toHaveCount(0);
    expect(await oldShellCssLoaded(page)).toBe(false);
  });

  test('аккаунт без флага на том же устройстве получает прежний кабинет', async ({ page }) => {
    await mockSignedInCabinet(page);
    await page.addInitScript(() => window.localStorage.setItem('oq_cabinet_b640', '1'));
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('career-shell').getByRole('main')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('cabinet-b640')).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('oq_cabinet_b640'))).toBeNull();
  });
});
