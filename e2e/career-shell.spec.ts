import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { captureCareerHarness } from './helpers/capture-career-harness';

const EVIDENCE_DIR = e2eEvidenceDirectory('S10-VIS');
const MOBILE_SHELL_EVIDENCE_DIR = e2eEvidenceDirectory('ACC-0-2');

function evidenceScreenshot(name: string): string {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  return join(EVIDENCE_DIR, `${name}.png`);
}

function mobileShellEvidenceScreenshot(name: string): string {
  mkdirSync(MOBILE_SHELL_EVIDENCE_DIR, { recursive: true });
  return join(MOBILE_SHELL_EVIDENCE_DIR, `${name}.png`);
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
  expect(overflow).toBeLessThanOrEqual(0);
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

test('ACC-0-1 narrow consultant overlay preserves content and focus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'desktop only');
  await page.setViewportSize({ width: 1176, height: 900 });
  await openCabinet(page);
  const panel = page.locator('.career-expert-panel');
  const strip = panel.getByRole('button', { name: 'Развернуть консультанта', exact: true });
  for (const width of [1176, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel).toHaveClass(/consultant-strip/);
    expect((await panel.boundingBox())?.width).toBe(56);
    const before = await page.locator('.career-main').boundingBox();
    await strip.click();
    await expect(panel).toHaveClass(/consultant-overlay/);
    expect((await panel.boundingBox())?.width).toBe(360);
    if (width === 1176)
      await page.screenshot({ path: 'test-results/evidence/ACC-0-1/overlay-1176.png' });
    expect((await page.locator('.career-main').boundingBox())?.width).toBe(before?.width);
    await page.keyboard.press('Escape');
    await expect(strip).toBeFocused();
    await strip.press('Enter');
    await page.locator('.consultant-scrim').click({ position: { x: 10, y: 100 } });
    await expect(strip).toBeFocused();
    await strip.click();
    await panel.getByRole('button', { name: 'Свернуть консультанта в полосу' }).click();
    await expect(strip).toBeFocused();
  }
  await page.screenshot({ path: 'test-results/evidence/ACC-0-1/strip-1024.png' });
});

test('ACC-0-1 server history loads, opens, returns, retries and empties', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'desktop only');
  await openCabinet(page);
  let fail = true;
  let empty = false;
  const item = {
    id: '00000000-0000-4000-8000-000000000001',
    stage: 'today',
    firstPhrase: 'Обсудим следующий шаг',
    summary: null,
    lastMessageAt: '2026-10-15T10:00:00Z',
    openedAt: '2026-10-15T10:00:00Z',
    closedAt: null,
    messageCount: 1,
  };
  await page.route('**/api/v1/candidate/consultant-history**', async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, json: { error: { message: 'offline' } } });
      return;
    }
    const detail = new URL(route.request().url()).pathname.endsWith(item.id);
    await route.fulfill({
      json: {
        data: detail
          ? {
              ...item,
              messages: [
                {
                  id: 'history-message',
                  role: 'assistant',
                  content: 'Сохранённый ответ консультанта',
                  createdAt: item.lastMessageAt,
                },
              ],
            }
          : empty
            ? []
            : [item],
      },
    });
  });
  const panel = page.locator('.career-expert-panel');
  await panel.getByRole('button', { name: 'История бесед', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Не удалось загрузить');
  fail = false;
  await panel.getByRole('button', { name: 'Повторить', exact: true }).click();
  await panel.getByRole('button', { name: 'Открыть беседу: Обсудим следующий шаг' }).click();
  await expect(panel.getByLabel('Открытая беседа')).toContainText('Сохранённый ответ');
  await page.screenshot({ path: 'test-results/evidence/ACC-0-1/history-detail-1440.png' });
  await panel.getByRole('button', { name: 'К истории', exact: true }).click();
  const historyButton = panel.getByRole('button', { name: 'История бесед', exact: true });
  await expect(historyButton).toHaveAttribute('aria-pressed', 'true');
  await historyButton.click();
  await expect(historyButton).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByLabel('Сообщение карьерному консультанту')).toBeVisible();
  empty = true;
  await panel.getByRole('button', { name: 'История бесед', exact: true }).click();
  await expect(panel).toContainText('Бесед пока нет.');
  await page.screenshot({ path: 'test-results/evidence/ACC-0-1/history-empty-1440.png' });
});

test('keeps the fixed desktop rail and docks the consultant beside the page', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'The docked-panel audit runs on desktop.');
  await openCabinet(page);
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
  for (const control of await panel.locator('.career-expert-panel-controls > button').all()) {
    const box = await control.boundingBox();
    expect(box?.width).toBe(44);
    expect(box?.height).toBe(44);
  }
  expect((mainBox?.x ?? 0) + (mainBox?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
  const primaryRail = rail.getByRole('navigation', { name: 'Разделы кабинета' });
  await expect(primaryRail.getByRole('button')).toHaveText([
    'Сегодня',
    'Профиль',
    'Карьера',
    'Вакансии',
    'Отклики',
    'Дневник',
    'Автоматизация',
  ]);
  await expect(rail.getByRole('button', { name: 'Тарифы', exact: true })).toBeEnabled();
  await expect(rail.getByRole('button', { name: 'Открыть аккаунт', exact: true })).toBeEnabled();
  await expect(rail.locator('.career-rail-avatar')).toHaveCount(0);
  await expect(rail).not.toContainText('План');
  await expect(rail).not.toContainText('qa-readability@example.com');

  const today = rail.locator('.career-nav-button').first();
  await today.hover();
  const hint = page.locator('.career-desktop-topbar-hint');
  await expect(hint).toContainText('Сегодня');
  await expect(page.locator('.career-tooltip-bubble[data-open="true"]')).toHaveCount(0);
  await today.focus();
  await expect(hint).toContainText('Сегодня');
  await expectPanelAccessible(page);
  await page.screenshot({
    path: evidenceScreenshot('shell-1440'),
    fullPage: true,
  });
  await captureCareerHarness(page, join(EVIDENCE_DIR, 'shell-1440.html'));

  await primaryRail.getByRole('button', { name: 'Карьера', exact: true }).click();
  await expect(page.locator('.career-shell')).toHaveAttribute('data-shell-view', 'career');
  await expect(page.locator('.career-desktop-topbar h1')).toHaveText('Карьера');
  await expect(page.locator('.career-screen')).toBeVisible();

  await primaryRail.getByRole('button', { name: 'Автоматизация', exact: true }).click();
  await expect(
    page.getByLabel('Раздел Автоматизация').getByRole('heading', { name: 'Автоматизация' }),
  ).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Автоматизация' })).toBeVisible();

  await primaryRail.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Сегодня' })).toBeVisible();
  await expect(panel).toBeVisible();

  // Below 1280 px the consultant folds away so the screen keeps its columns; it returns on a
  // wide window (the .app is resized live, so the line is crossed after the first render).
  await page.setViewportSize({ width: 1176, height: 900 });
  await expect(panel).toHaveClass(/consultant-strip/);
  expect((await panel.boundingBox())?.width).toBe(56);
  await expectNoOverflow(page);
  expect((await page.locator('.career-main').boundingBox())?.width).toBeGreaterThan(1000);

  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel).toBeVisible();
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
  await panel.getByRole('button', { name: 'Свернуть консультанта в полосу' }).click();
  await expect(panel).toHaveClass(/consultant-strip/);
  expect((await panel.boundingBox())?.width).toBe(56);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.career-cabinet')).toBeVisible();
  await expect(panel).toHaveClass(/consultant-strip/);
  await panel.getByRole('button', { name: 'Развернуть консультанта', exact: true }).click();
  await expect(panel).toBeVisible();
});

async function expectMobileShellGeometry(page: Page): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Разделы' });
  const header = page.locator('.career-topbar');
  await expect(header.locator('.career-notification-bell')).toBeVisible();
  await expect(header.locator('h1')).toHaveText('Сегодня');
  await expect(page.getByRole('button', { name: 'Консультант: открыть' })).toBeVisible();
  await expect(navigation.getByRole('button')).toHaveCount(5);
  await expect(page.locator('.career-mobile-tariffs')).toHaveCount(0);
  await expect(page.locator('.career-account-trigger')).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: 'Сегодня' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const metrics = await page.evaluate(() => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const nav = document.querySelector('nav.career-mobile-nav');
    const header = document.querySelector('header.career-topbar');
    return {
      navigation: box(nav),
      bell: box(header?.querySelector('.career-notification-bell') ?? null),
      title: box(header?.querySelector('h1') ?? null),
      consultant: box(header?.querySelector('.career-mobile-consultant-trigger') ?? null),
      navItems: [...(nav?.querySelectorAll('button') ?? [])].map(box),
      bottomGap: nav ? window.innerHeight - nav.getBoundingClientRect().bottom : null,
    };
  });
  expect(metrics.navigation?.x).toBe(12);
  expect(metrics.navigation?.width).toBe(366);
  expect(metrics.navigation?.height).toBe(62);
  expect(metrics.bell?.width).toBe(44);
  expect(metrics.bell?.height).toBe(44);
  expect(metrics.consultant?.width).toBe(44);
  expect(metrics.consultant?.height).toBe(44);
  expect(
    Math.abs((metrics.title?.x ?? 0) + (metrics.title?.width ?? 0) / 2 - 195),
  ).toBeLessThanOrEqual(1);
  expect(metrics.bottomGap).toBeGreaterThanOrEqual(12);
  expect(metrics.navItems).toHaveLength(5);
  expect(
    metrics.navItems.every((item) => item && Math.abs(item.width - 69) <= 1 && item.height === 52),
  ).toBe(true);
}

async function expectMoreMenu(page: Page): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Разделы' });
  const more = navigation.getByRole('button', { name: 'Ещё' });
  const labels = [
    'Карьера',
    'Карьерный дневник',
    'Автоматизация',
    'Тарифы',
    'Аккаунт',
    'Консультант',
  ];
  await more.click();
  const menu = page.getByRole('menu', { name: 'Ещё разделы' });
  await expect(menu.getByRole('menuitem')).toHaveCount(labels.length);
  for (const label of labels) {
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await expect(menu).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть меню разделов' }).click({
    position: { x: 10, y: 100 },
  });
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
}

async function navigateFromMore(page: Page, label: string, contentSelector: string): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Разделы' });
  const more = navigation.getByRole('button', { name: 'Ещё' });
  await more.click();
  await page
    .getByRole('menu', { name: 'Ещё разделы' })
    .getByRole('menuitem', { name: label, exact: true })
    .click();
  await expect(page.locator(contentSelector).first()).toBeVisible();
  await expect(more).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('button', { name: 'Сегодня', exact: true }).click();
}

async function expectMoreDestinations(page: Page): Promise<void> {
  await navigateFromMore(page, 'Карьера', '.career-screen');
  await navigateFromMore(page, 'Автоматизация', '.automation-screen');

  const navigation = page.getByRole('navigation', { name: 'Разделы' });
  const more = navigation.getByRole('button', { name: 'Ещё' });
  await more.click();
  const diary = page
    .getByRole('menu', { name: 'Ещё разделы' })
    .getByRole('menuitem', { name: 'Карьерный дневник', exact: true });
  if (await diary.isEnabled()) {
    await diary.click();
    await expect(page.locator('.career-diary-page')).toBeVisible();
    await expect(more).toHaveAttribute('aria-current', 'page');
    await navigation.getByRole('button', { name: 'Сегодня', exact: true }).click();
  } else {
    await page.keyboard.press('Escape');
  }

  await more.click();
  await page
    .getByRole('menu', { name: 'Ещё разделы' })
    .getByRole('menuitem', { name: 'Тарифы', exact: true })
    .click();
  await expect(
    page.locator('.career-main-content').getByRole('heading', { name: 'Тарифы', exact: true }),
  ).toBeVisible();
  await expect(more).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('button', { name: 'Сегодня', exact: true }).click();

  await more.click();
  await page
    .getByRole('menu', { name: 'Ещё разделы' })
    .getByRole('menuitem', { name: 'Аккаунт', exact: true })
    .click();
  await expect(
    page.locator('.career-account-container').getByRole('heading', { name: 'Профиль и вход' }),
  ).toBeVisible();
  await expect(more).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('button', { name: 'Сегодня', exact: true }).click();
}

async function expectConsultantSheetGeometry(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Консультант: открыть' });
  await trigger.click();
  const panel = page.locator('.career-shell > .panel-col.is-open .career-expert-panel');
  await expect(page.getByRole('dialog', { name: /Консультант/u })).toBeVisible();
  await expect(panel).toHaveAttribute('data-mobile-expanded', 'true');
  await expectPanelAccessible(page);
  const [sheet, header, composer, textarea, composerAction] = await Promise.all([
    panel.boundingBox(),
    panel.locator('header').boundingBox(),
    panel.locator('.career-expert-composer').boundingBox(),
    panel.locator('.career-expert-composer textarea').boundingBox(),
    panel.getByRole('button', { name: 'Голосовой ввод' }).boundingBox(),
  ]);
  expect(sheet?.x).toBe(0);
  expect(Math.abs((sheet?.y ?? 0) - 253)).toBeLessThanOrEqual(1);
  expect(sheet?.width).toBe(390);
  expect(Math.abs((sheet?.height ?? 0) - 591)).toBeLessThanOrEqual(1);
  expect(header?.height).toBe(61);
  expect(composer?.height).toBe(95);
  expect(textarea?.width).toBe(358);
  expect(textarea?.height).toBe(44);
  expect(composerAction?.width).toBe(36);
  expect(composerAction?.height).toBe(36);
}

async function expectConsultantFocusTrap(page: Page): Promise<void> {
  const panel = page.getByRole('dialog', { name: /Консультант/u });
  const controls = panel.locator(
    'button:not([disabled]):visible, textarea:not([disabled]):visible, input:not([disabled]):visible',
  );
  const first = controls.first();
  const last = controls.last();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
}

async function expectMobileComposerActions(page: Page): Promise<void> {
  const panel = page.getByRole('dialog', { name: /Консультант/u });
  const input = panel.getByLabel('Сообщение карьерному консультанту');
  await input.fill('Проверяю действие отправки');
  await expect(panel.getByRole('button', { name: 'Отправить вопрос', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Голосовой ввод' })).toBeHidden();
}

async function closeConsultantBySheetButton(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Консультант: открыть' });
  await page.getByRole('button', { name: 'Развернуть или свернуть консультанта' }).click();
  await expect(page.locator('.panel-col.is-open')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function closeConsultantByEscape(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Консультант: открыть' });
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.panel-col.is-open')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function openConsultantFromMore(page: Page): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Разделы' });
  await navigation.getByRole('button', { name: 'Ещё' }).click();
  await page
    .getByRole('menu', { name: 'Ещё разделы' })
    .getByRole('menuitem', { name: 'Консультант', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: /Консультант/u })).toBeVisible();
}

async function closeConsultantByBackdrop(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Консультант: открыть' });
  await page.getByRole('button', { name: 'Закрыть консультанта' }).click({
    position: { x: 12, y: 100 },
  });
  await expect(page.locator('.panel-col.is-open')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

test('ACC-0-2 mobile shell geometry, menu actions and consultant sheet match the approved layout', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The compact shell audit runs on mobile.');
  await page.setViewportSize({ width: 390, height: 844 });
  await openCabinet(page);
  await expectMobileShellGeometry(page);
  await expectMoreMenu(page);
  await expectMoreDestinations(page);
  await page.screenshot({
    path: mobileShellEvidenceScreenshot('shell-390'),
    fullPage: true,
  });
  await expectConsultantSheetGeometry(page);
  await expectConsultantFocusTrap(page);
  await page.screenshot({
    path: mobileShellEvidenceScreenshot('shell-390-consultant-expanded'),
    fullPage: true,
  });
  await expectMobileComposerActions(page);
  await closeConsultantBySheetButton(page);
  await closeConsultantByEscape(page);
  await openConsultantFromMore(page);
  await closeConsultantByBackdrop(page);
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoOverflow(page);
  }
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
  await expect(page.getByText('Загрузка дольше обычного.')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: evidenceScreenshot(`${testInfo.project.name}-session-slow`),
    fullPage: true,
  });
  releaseSession();
  await expect(page.locator('.career-cabinet')).toBeVisible();
});
