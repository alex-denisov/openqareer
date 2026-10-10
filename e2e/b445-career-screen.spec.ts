import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/v1-release/tasks/evidence/B445');
const CLI_PATH = path.resolve(process.cwd(), 'src/features/career-map/renderCareerCli.ts');
const BATCH_HTML_DIR = path.join(os.tmpdir(), 'oq-b445-html');

function readHtml(filename: string): string {
  return fs.readFileSync(path.join(BATCH_HTML_DIR, filename), 'utf8');
}

test.describe('B445: Career Screen Mockup 3 (1440 and 390)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.mkdirSync(BATCH_HTML_DIR, { recursive: true });
    execFileSync('npx', ['tsx', CLI_PATH, '--batch-dir', BATCH_HTML_DIR], {
      encoding: 'utf8',
      stdio: 'inherit',
    });
  });

  test('desktop 1440 renders roles, wage rules, search conditions, and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.setViewportSize({ width: 1440, height: 900 });

    const html = readHtml('desktop-1440.html');
    await page.setContent(html, { waitUntil: 'load' });

    // 1. No horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    // 2. Roles list & wage fork rules (Criterion 1 & 4)
    await expect(page.getByRole('heading', { level: 1, name: 'Карьера' })).toBeVisible();
    await expect(page.locator('text=Director of Engineering').first()).toBeVisible();
    await expect(page.locator('text=600–780 тыс. ₽ · 88 вакансий · 05.10')).toBeVisible();

    // VP Engineering with 4 vacancies suppresses wage
    await expect(page.locator('text=VP Engineering')).toBeVisible();
    await expect(page.locator('text=вилка не считается · 4 вакансий · 05.10')).toBeVisible();

    // 3. Search conditions block
    await expect(page.getByRole('heading', { level: 2, name: 'Условия поиска' })).toBeVisible();
    await expect(page.locator('text=Москва, Удалённо из РФ')).toBeVisible();
    await expect(page.locator('text=450 000 ₽')).toBeVisible();
    await expect(page.locator('text=Гибрид, удалённо')).toBeVisible();
    await expect(page.locator('text=2 компании')).toBeVisible();
    await expect(page.locator('text=148 вакансий из 214 по ролям')).toBeVisible();

    // 4. Relocation block
    await expect(page.locator('text=Страны и релокация')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Включить релокацию' })).toBeVisible();

    // 5. Source stamp
    await expect(
      page.locator('text=Источник: каталог openqareer, hh.ru и LinkedIn · 312 вакансий · 05.10'),
    ).toBeVisible();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-desktop-1440.png'),
      fullPage: true,
    });
  });

  test('mobile 390 renders home and push views without overflow, and captures evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
    await page.setViewportSize({ width: 390, height: 844 });

    // Home view
    const homeHtml = readHtml('mobile-390.html');
    await page.setContent(homeHtml, { waitUntil: 'load' });

    const overflowMobile = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflowMobile).toBe(false);

    await expect(page.locator('text=Director of Engineering').first()).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-mobile-390.png'),
      fullPage: true,
    });

    // Push view: Role detail (dir)
    const dirHtml = readHtml('mobile-390-dir.html');
    await page.setContent(dirHtml, { waitUntil: 'load' });
    await expect(page.locator('h3:has-text("Director of Engineering")')).toBeVisible();
    await expect(page.locator('text=Навыки проверены')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Дозаполнить с консультантом' })).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-mobile-390-dir.png'),
      fullPage: true,
    });

    // Push view: Salary edit (sal)
    const salHtml = readHtml('mobile-390-sal.html');
    await page.setContent(salHtml, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: 'Зарплата от' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-mobile-390-sal.png'),
      fullPage: true,
    });
  });

  test('captures evidence for all special states (empty, error, stale, loading)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.setViewportSize({ width: 1440, height: 900 });

    // Empty profile
    await page.setContent(readHtml('desktop-1440-empty.html'), { waitUntil: 'load' });
    await expect(page.locator('text=Гипотез нет: профиль пуст')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-desktop-1440-empty.png'),
      fullPage: true,
    });

    // Market error
    await page.setContent(readHtml('desktop-1440-error.html'), { waitUntil: 'load' });
    await expect(page.locator('text=Позиция на рынке не загрузилась')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-desktop-1440-error.png'),
      fullPage: true,
    });

    // Stale market
    await page.setContent(readHtml('desktop-1440-stale.html'), { waitUntil: 'load' });
    await expect(page.locator('text=прошло больше 14 дней')).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-desktop-1440-stale.png'),
      fullPage: true,
    });

    // Loading skeleton
    await page.setContent(readHtml('desktop-1440-loading.html'), { waitUntil: 'load' });
    await expect(
      page.locator('text=Позиция, гипотезы и условия грузятся независимо.'),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'career-desktop-1440-loading.png'),
      fullPage: true,
    });
  });
});
