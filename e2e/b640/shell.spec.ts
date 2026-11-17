import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { B640_NODES } from '../../src/features/b640/routes';

const SHOTS = process.env.B640_SHOTS;

async function openCabinet(page: Page, path: string): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
}

function samplePath(path: string): string {
  return path.replace(/:[A-Za-z]+/gu, 'x1');
}

test.describe('B649: оболочка нового кабинета', () => {
  test('каждый из 72 узлов открывается по своему адресу и показывает свой раздел', async ({
    page,
  }) => {
    await openCabinet(page, '/app');
    for (const node of B640_NODES) {
      await page.evaluate((path) => {
        window.history.pushState(null, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, samplePath(node.path));
      if (node.section === 'consultant') {
        // B700: консультант — панель над «Сегодня», своей страницы у него нет.
        await expect(page.locator('.b640 aside.panel-col'), node.path).toBeVisible();
        await expect(page.locator('[data-b640-node="s03"]'), node.path).toBeVisible();
        continue;
      }
      const screen = page.locator(`[data-b640-node="${node.code}"]`);
      await expect(screen, node.path).toBeVisible();
      await expect(screen).toHaveAttribute('data-b640-section', node.section);
    }
  });

  test('1440 и 1176: рейл и верхняя полоса, нижней навигации нет', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'широкие окна');
    await openCabinet(page, '/app/profile');
    for (const width of [1440, 1176]) {
      await page.setViewportSize({ width, height: 900 });
      const rail = page.locator('.b640 .rail');
      await expect(rail).toBeVisible();
      await expect(rail.locator('a.nav')).toHaveCount(7);
      await expect(rail.locator('a.nav[aria-current="page"]')).toHaveText('Профиль');
      await expect(page.locator('.b640 .topbar h1')).toHaveText('Профиль');
      await expect(page.locator('.b640 .top-actions')).toBeVisible();
      await expect(page.locator('.b640 .bottomnav')).toBeHidden();
      const account = await rail.locator('.rail-end').boundingBox();
      expect(account && account.y + account.height).toBeLessThanOrEqual(900);
    }
  });

  test('390: шапка по токенам, пять равных колонок внизу, меню «Ещё»', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'телефон');
    await openCabinet(page, '/app/profile/status');
    await expect(page.locator('.b640 .rail')).toBeHidden();
    const sizes = await page.evaluate(() => {
      const root = document.querySelector('.b640') as HTMLElement;
      const token = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
      const title = getComputedStyle(document.querySelector('.b640 .topbar h1') as HTMLElement);
      const back = document.querySelector('.b640 .mob-back') as HTMLElement;
      const circle = getComputedStyle(back, '::before');
      return {
        titleToken: token('--career-ios-title'),
        buttonToken: token('--career-ios-btn'),
        iconToken: token('--career-ios-icon'),
        titleSize: title.fontSize,
        target: back.getBoundingClientRect().width,
        circleWidth: circle.width,
        circleHeight: circle.height,
        iconWidth: getComputedStyle(back.querySelector('svg') as SVGElement).width,
      };
    });
    expect(sizes.titleToken).toBe('17px');
    expect(sizes.titleSize).toBe(sizes.titleToken);
    // Поле касания 44 px, видимый круг и значок — по токенам шапки.
    expect(sizes.target).toBe(44);
    expect(sizes.circleWidth).toBe(sizes.buttonToken);
    expect(sizes.circleHeight).toBe(sizes.buttonToken);
    expect(sizes.iconWidth).toBe(sizes.iconToken);
    await expect(page.locator('.b640 .mob-back')).toHaveAttribute('aria-label', 'Назад к профилю');

    const columns = await page
      .locator('.b640 .bottomnav > *')
      .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().width)));
    expect(columns).toHaveLength(5);
    expect(Math.max(...columns) - Math.min(...columns)).toBeLessThanOrEqual(1);

    const more = page.locator('.b640 .more-btn');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: 'Ещё разделы' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Карьера',
      'Карьерный дневник',
      'Уведомления',
      'Тарифы',
      /Аккаунт/u,
    ]);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await more.click();
    await menu.getByRole('menuitem', { name: 'Карьера' }).click();
    await expect(page.locator('[data-b640-node="s09"]')).toBeVisible();
    await expect(more).toHaveAttribute('aria-current', 'page');
  });

  test('переход по рейлу меняет адрес без перезагрузки, «Назад» браузера возвращает', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'рейл есть на широком окне');
    await openCabinet(page, '/app');
    await page.evaluate(() => {
      (window as unknown as { b640Probe: number }).b640Probe = 1;
    });
    await page.locator('.b640 .rail a.nav', { hasText: 'Вакансии' }).click();
    await expect(page).toHaveURL(/\/app\/vacancies$/u);
    await expect(page.locator('[data-b640-node="s07"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-b640-node="s03"]')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { b640Probe?: number }).b640Probe)).toBe(
      1,
    );
  });

  test('снимки оболочки для сверки с макетами', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    const widths = desktop ? [1440, 1176] : [390];
    await openCabinet(page, '/app');
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      for (const [name, path] of [
        ['shell-today', '/app'],
        ['shell-nested', '/app/profile/experience/x1'],
        ['shell-tabs', '/app/account/connections'],
      ] as const) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        for (const width of widths) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({ path: `.s13-shots/${name}-${width}-${theme}.png` });
        }
      }
    }
  });
});
