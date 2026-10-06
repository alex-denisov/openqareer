import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { candidateSnapshot } from './fixtures/readabilityWorkspace';
import { captureCareerHarness } from './helpers/capture-career-harness';

test('builds a targeted resume from vacancy requirements and prints only that slice', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const fixtureSnapshot = {
    ...candidateSnapshot,
    memory: candidateSnapshot.memory.map((item) => ({
      ...item,
      sourceMessageIds: [`b387-${item.id}`],
    })),
  };
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/me/memory**', (route) =>
    route.fulfill({
      json: { data: fixtureSnapshot.memory, meta: { nextOffset: null } },
    }),
  );
  await page.route(/\/api\/v1\/candidate\/me(?:\?.*)?$/u, (route) =>
    route.fulfill({
      json: {
        data: fixtureSnapshot,
        meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
      },
    }),
  );
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
  await expect(page.locator('.career-profile-screen-view')).toBeVisible();
  await page.getByRole('button', { name: 'Документ и форматы', exact: true }).click();
  await page.getByRole('button', { name: 'ATS Plain Text', exact: true }).click();

  await page.getByLabel('Название вакансии', { exact: true }).fill('Head of Product, Payments');
  await page
    .getByLabel('Требования вакансии', { exact: true })
    .fill('платёжного продукта\nSQL\nGraphQL');
  await page.getByRole('button', { name: 'Собрать целевое резюме', exact: true }).click();

  const targetedView = page.locator('.career-resume-ats-view');
  await expect(targetedView.getByRole('heading', { name: 'Что выделено в срезе' })).toBeVisible();
  await expect(targetedView).toContainText('GraphQL');
  await expect(targetedView).toContainText('не найдено в мастер-резюме');
  await expect(targetedView).toContainText('Руководитель продукта — FinCloud');
  await expect(targetedView).toContainText('подробности сохранены');
  await expect(targetedView).toContainText('оставлены роль и даты');
  await expect(targetedView.locator('.career-resume-ats-pre')).toContainText(
    'Рост выручки платёжного продукта',
  );
  const targetedText = await targetedView.locator('.career-resume-ats-pre').innerText();
  const gapSectionIndex = targetedText.indexOf('=== REQUIREMENT GAPS ===');
  expect(gapSectionIndex).toBeGreaterThanOrEqual(0);
  expect(targetedText.slice(0, gapSectionIndex)).not.toContain('GraphQL');
  expect(targetedText.slice(gapSectionIndex)).toContain('GraphQL - не найдено в мастер-резюме');

  const axe = await new AxeBuilder({ page }).include('.career-resume-ats-view').analyze();
  expect(
    axe.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? '')),
  ).toEqual([]);

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);

  const screenshotRoot = join('output', 'playwright', 'B387');
  await mkdir(screenshotRoot, { recursive: true });
  await page.screenshot({
    path: join(screenshotRoot, `${testInfo.project.name}-targeted-resume.png`),
  });
  await targetedView
    .getByRole('heading', { name: 'Что выделено в срезе' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(screenshotRoot, `${testInfo.project.name}-targeted-resume-summary.png`),
  });
  await captureCareerHarness(
    page,
    testInfo.outputPath('targeted-resume.html'),
    '.career-resume-ats-view',
  );

  await page.evaluate(() => {
    const targetWindow = window as Window & {
      __b387PrintState?: {
        targetMode: string | undefined;
        targetText: string;
      };
    };
    window.print = () => {
      const target = document.querySelector<HTMLElement>('.career-resume-print-targeted');
      targetWindow.__b387PrintState = {
        targetMode: document.body.dataset.resumePrintTarget,
        targetText: target?.innerText ?? '',
      };
    };
  });
  await page.getByRole('button', { name: 'Печать / PDF', exact: true }).click();
  const printState = await page.evaluate(
    () => (window as Window & { __b387PrintState?: unknown }).__b387PrintState,
  );
  expect(printState).toMatchObject({ targetMode: 'targeted' });
  expect((printState as { targetText: string }).targetText).toContain('GraphQL');

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => {
    document.body.dataset.resumePrintTarget = 'targeted';
  });
  const printDisplay = await page.evaluate(() => ({
    target: getComputedStyle(document.querySelector<HTMLElement>('.career-resume-print-targeted')!)
      .display,
    others: Array.from(document.querySelectorAll<HTMLElement>('.career-resume-print'))
      .filter((item) => !item.classList.contains('career-resume-print-targeted'))
      .map((item) => getComputedStyle(item).display),
  }));
  expect(printDisplay.target).toBe('block');
  expect(printDisplay.others.every((value) => value === 'none')).toBe(true);
  const pdfPath = join(screenshotRoot, `${testInfo.project.name}-targeted-resume.pdf`);
  const pdf = await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  await page.screenshot({
    path: join(screenshotRoot, `${testInfo.project.name}-targeted-resume-print.png`),
    fullPage: true,
  });
  await page.emulateMedia({ media: 'screen' });
  expect(browserErrors).toEqual([]);
});
