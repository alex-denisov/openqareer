import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/v1-release/tasks/evidence/B443');
const CLI_PATH = path.resolve(process.cwd(), 'src/features/account/renderAccountCli.ts');
const BATCH_HTML_DIR = path.join(os.tmpdir(), 'oq-b443-html');

function readHtml(filename: string): string {
  return fs.readFileSync(path.join(BATCH_HTML_DIR, filename), 'utf8');
}

test.describe('B443: Account Screen Mockup 8', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.mkdirSync(BATCH_HTML_DIR, { recursive: true });
    execFileSync('npx', ['tsx', CLI_PATH, '--batch-dir', BATCH_HTML_DIR], {
      encoding: 'utf8',
      stdio: 'inherit',
    });
  });

  test('desktop 1440 renders all sections, checks devices, notifications, consents and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Профиль и вход
    const profileHtml = readHtml('desktop-prof.html');
    await page.setContent(profileHtml, { waitUntil: 'load' });

    // Criterion 7: No horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    // Criterion 1: Tab list exists
    await expect(page.getByRole('tab', { name: 'Профиль и вход' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Подключения' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Уведомления' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Согласия и данные' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Приложение' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Подписка и платежи' })).toBeVisible();

    // Criterion 2: Device with "Эта сессия"
    await expect(page.locator('text=Эта сессия')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Выйти на других устройствах' })).toBeVisible();

    // Criterion 5: Honest "Скоро" tag
    await expect(page.locator('text=Двухфакторная защита')).toBeVisible();
    await expect(page.locator('text=Скоро').first()).toBeVisible();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-desktop-1440-profile.png'),
      fullPage: true,
    });

    // 2. Подключения
    const connHtml = readHtml('desktop-conn.html');
    await page.setContent(connHtml, { waitUntil: 'load' });
    await expect(page.locator('text=LinkedIn')).toBeVisible();
    await expect(page.locator('text=hh.ru')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-desktop-1440-connections.png'),
      fullPage: true,
    });

    // 3. Уведомления (Criterion 4)
    const notifHtml = readHtml('desktop-notif.html');
    await page.setContent(notifHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Ответ работодателя')).toBeVisible();
    await expect(
      page.locator('text=Столбец Telegram недоступен, пока бот не подключён'),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-desktop-1440-notif.png'),
      fullPage: true,
    });

    // 4. Согласия и данные (Criterion 3)
    const consentsHtml = readHtml('desktop-cons.html');
    await page.setContent(consentsHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Автоотклики')).toBeVisible();
    await expect(page.locator('text=Дано 03.10')).toBeVisible();
    await expect(page.locator('text=Удалить аккаунт')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-desktop-1440-consents.png'),
      fullPage: true,
    });

    // 5. Приложение (Criterion 6 on desktop)
    const appHtml = readHtml('desktop-app.html');
    await page.setContent(appHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Автообновление')).toBeVisible();
    await expect(page.locator('text=Значок в строке меню')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-desktop-1440-app.png'),
      fullPage: true,
    });

    // 6. Подписка Pro
    const payHtml = readHtml('desktop-pay-pro.html');
    await page.setContent(payHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Pro, 9 900 ₽ в месяц')).toBeVisible();
    await expect(page.locator('text=История платежей')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-desktop-1440-pay-pro.png'),
      fullPage: true,
    });
  });

  test('mobile 390 renders push views, verifies absence of app section, and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Главная
    const homeHtml = readHtml('mobile-home.html');
    await page.setContent(homeHtml, { waitUntil: 'load' });

    // Criterion 7: No horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    // Criterion 6: On 390 NO «Приложение» section!
    await expect(page.locator('text=Приложение')).not.toBeVisible();
    await expect(page.locator('text=Профиль и вход')).toBeVisible();
    await expect(page.locator('text=Подключения')).toBeVisible();
    await expect(page.locator('text=Уведомления')).toBeVisible();
    await expect(page.locator('text=Согласия и данные')).toBeVisible();
    await expect(page.locator('text=Подписка и платежи')).toBeVisible();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-mobile-390-home.png'),
      fullPage: true,
    });

    // 2. Устройства (Criterion 2)
    const devHtml = readHtml('mobile-dev.html');
    await page.setContent(devHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Входы и устройства')).toBeVisible();
    await expect(page.locator('text=Эта сессия')).toBeVisible();
    await expect(page.locator('text=Выйти на других устройствах')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-mobile-390-devices.png'),
      fullPage: true,
    });

    // 3. Подключения
    const connHtml = readHtml('mobile-conn.html');
    await page.setContent(connHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Подключения')).toBeVisible();
    await expect(page.locator('text=LinkedIn')).toBeVisible();
    await expect(page.locator('text=hh.ru')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-mobile-390-connections.png'),
      fullPage: true,
    });

    // 4. Уведомления (Criterion 4)
    const notifHtml = readHtml('mobile-notif.html');
    await page.setContent(notifHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Уведомления')).toBeVisible();
    await expect(page.locator('text=Telegram не подключён')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-mobile-390-notif.png'),
      fullPage: true,
    });

    // 5. Согласия (Criterion 3)
    const consentsHtml = readHtml('mobile-cons.html');
    await page.setContent(consentsHtml, { waitUntil: 'load' });
    await expect(page.locator('text=Согласия и данные')).toBeVisible();
    await expect(page.locator('text=Автоотклики')).toBeVisible();
    await expect(page.locator('text=Удалить аккаунт')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'account-mobile-390-consents.png'),
      fullPage: true,
    });
  });
});
