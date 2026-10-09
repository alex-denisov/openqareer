import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

function evidenceScreenshot(name: string): string {
  const directory = 'output/playwright/B440';
  mkdirSync(directory, { recursive: true });
  return `${directory}/${name}.png`;
}

async function openCabinet(page: import('@playwright/test').Page): Promise<void> {
  await mockSignedInCabinet(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.locator('.career-cabinet')).toBeVisible();
}

async function expectNoOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectPanelAccessible(page: import('@playwright/test').Page): Promise<void> {
  const result = await new AxeBuilder({ page }).include('.career-expert-panel').analyze();
  expect(
    result.violations
      .filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))
      .map((violation) => ({
        id: violation.id,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target),
      })),
  ).toEqual([]);
}

test('keeps the fixed desktop rail and docks the consultant beside the page', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'The docked-panel audit runs on desktop.');
  await openCabinet(page);
  await page.getByRole('button', { name: 'Спросить консультанта' }).click();
  const rail = page.locator('.career-rail');
  const panel = page.locator('.career-expert-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('complementary', { name: /Консультант/u })).toBeVisible();
  await expect(panel).not.toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('.career-rail-toggle')).toHaveCount(0);
  const railBox = await rail.boundingBox();
  const panelBox = await panel.boundingBox();
  const mainBox = await page.locator('.career-main').boundingBox();
  expect(railBox?.width).toBe(76);
  expect(panelBox?.width).toBe(360);
  expect((mainBox?.x ?? 0) + (mainBox?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
  await expect(rail.getByRole('button', { name: 'Тарифы', exact: true })).toBeEnabled();
  await expect(rail).not.toContainText('План');
  await expect(rail).not.toContainText('qa-readability@example.com');

  const today = rail.locator('.career-nav-button').first();
  await today.hover();
  const tooltip = page.locator('.career-tooltip-bubble[data-open="true"]');
  await expect(tooltip).toContainText('Сегодня');
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox?.x).toBeGreaterThanOrEqual((railBox?.x ?? 0) + (railBox?.width ?? 0));
  await today.focus();
  await expect(tooltip).toContainText('Сегодня');
  await expectPanelAccessible(page);
  await page.screenshot({
    path: evidenceScreenshot('desktop-docked-consultant'),
    fullPage: true,
  });

  for (const width of [1176, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const currentRail = await rail.boundingBox();
    const currentPanel = await panel.boundingBox();
    const currentMain = await page.locator('.career-main').boundingBox();
    expect(currentRail?.width).toBe(76);
    expect(currentPanel?.width).toBe(360);
    expect((currentMain?.x ?? 0) + (currentMain?.width ?? 0)).toBeLessThanOrEqual(
      currentPanel?.x ?? 0,
    );
    await expectNoOverflow(page);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await panel.getByRole('button', { name: 'Закрыть карьерного консультанта' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Спросить консультанта' }).click();
  await expect(panel).toBeVisible();
});

test('mobile navigation uses four sections plus More and the consultant sheet collapses on Escape', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The compact navigation audit runs on mobile.');
  await openCabinet(page);
  await page.getByRole('button', { name: 'Спросить консультанта' }).click();
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  const panel = page.locator('.career-expert-panel');
  const more = navigation.getByRole('button', { name: 'Ещё' });
  await expect(page.getByRole('button', { name: 'Тарифы' })).toBeVisible();
  await expect(navigation.getByRole('button')).toHaveCount(5);
  await expect(panel).toHaveAttribute('data-mobile-expanded', 'false');
  await expect(page.locator('.career-main')).toHaveCSS('overflow-y', 'auto');
  await expectPanelAccessible(page);

  const targets = await navigation.getByRole('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  expect(targets).toHaveLength(5);
  expect(targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);

  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: evidenceScreenshot('mobile-collapsed-consultant'),
    fullPage: true,
  });

  await more.click();
  const menu = page.getByRole('menu', { name: 'Ещё разделы' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Карьера' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  const panelToggle = panel.getByRole('button', { name: 'Развернуть консультанта' });
  await panelToggle.click();
  await expect(panel).toHaveAttribute('data-mobile-expanded', 'true');
  await expectPanelAccessible(page);
  await page.screenshot({
    path: evidenceScreenshot('mobile-expanded-consultant'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-mobile-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await page.getByRole('button', { name: 'Спросить консультанта' }).click();
  const composer = page.getByLabel('Сообщение карьерному консультанту');
  await expect(composer).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Голосовой ввод скоро' })).toBeDisabled();
  await page.getByRole('button', { name: 'С чего начать?' }).click();
  await expect(composer).toHaveValue('С чего начать?');
  await expect(panel.getByRole('button', { name: 'Отправить вопрос' })).toBeEnabled();
});

test('keeps the shell visible while the shell module is still loading', async ({
  page,
}, testInfo) => {
  let releaseChunk!: () => void;
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  await mockSignedInCabinet(page);
  await page.route(/\/assets\/CareerWorkspaceShell-[^/]+\.js$/u, async (route) => {
    await chunkGate;
    await route.fallback();
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.career-bootstrap-shell')).toBeVisible();
  await expect(
    page.locator('#root > .bootstrap-loading, #root [data-bootstrap-shell="true"]'),
  ).toHaveCount(0);
  await expect(page.locator('.career-bootstrap-shell .career-today-skeleton-status')).toHaveText(
    'Проверяем вход и читаем ваш профиль',
  );
  if (testInfo.project.name === 'desktop-1440') {
    await expect(page.locator('.career-bootstrap-rail')).toBeVisible();
  } else {
    await expect(page.locator('.career-bootstrap-topbar')).toBeVisible();
    await expect(page.locator('.career-bootstrap-mobile-nav')).toBeVisible();
  }
  await page.screenshot({
    path: evidenceScreenshot(`${testInfo.project.name}-shell-bootstrap`),
    fullPage: true,
  });
  await expect(page.locator('.career-bootstrap-shell .career-today-skeleton-status')).toHaveText(
    'Проверяем вход и читаем ваш профиль',
  );
  releaseChunk();
  await expect(page.locator('.career-shell:not(.career-bootstrap-shell)')).toBeVisible();
  await expect(page.locator('.career-cabinet')).toBeVisible();
});

test('offers a retry when the server does not answer, then recovers', async ({
  page,
}, testInfo) => {
  let failOnce = true;
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/auth/me', async (route) => {
    if (failOnce) {
      failOnce = false;
      return route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
    }
    return route.fallback();
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText('Ошибка: сервер не ответил.');
  await page.screenshot({
    path: evidenceScreenshot(`${testInfo.project.name}-session-error`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.career-cabinet')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('announces a slow session read after four seconds and retries the same request', async ({
  page,
}, testInfo) => {
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/auth/me', async (route) => {
    await sessionGate;
    return route.fallback();
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Проверяем вход и читаем ваш профиль')).toBeVisible();
  await expect(page.getByText('Загрузка дольше обычного.')).toBeVisible({ timeout: 7_000 });
  await page.screenshot({
    path: evidenceScreenshot(`${testInfo.project.name}-session-slow`),
    fullPage: true,
  });
  releaseSession();
  await expect(page.locator('.career-cabinet')).toBeVisible();
});
