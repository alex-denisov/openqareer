import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const evidenceDirectory = e2eEvidenceDirectory('B466');

const interviewApplication = {
  id: 'application-star-1',
  candidateId: 'candidate-star-test',
  clusterId: null,
  stage: 'interview',
  closedReason: null,
  archiveReason: null,
  archivePreviousStage: null,
  processProfile: 'standard',
  vacancy: {
    title: 'Руководитель инженерной команды',
    company: 'Тестовая компания',
    companyHidden: false,
    url: 'https://example.test/jobs/1',
    source: 'synthetic',
  },
  notes: null,
  followUpDueAt: null,
  stageChangedAt: '2026-10-01T10:00:00.000Z',
  version: 1,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  followUp: null,
  whoseTurn: 'candidate',
  materials: { coverLetter: false, resume: false },
  nearestInterview: { id: 'interview-star-1', scheduledAt: null, prepStatus: 'not_started' },
  archiveStaleDays: 30,
};

async function openStories(page: Page, width: number): Promise<void> {
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/applications*', (route) =>
    route.fulfill({ json: { data: [interviewApplication] } }),
  );
  await page.setViewportSize({ width, height: width <= 760 ? 844 : 900 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (width <= 760) {
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Отклики' }).click();
  } else {
    await page.locator('aside#career-rail nav').getByRole('button', { name: 'Отклики' }).click();
  }
  const card = page
    .locator('.career-responses-card')
    .filter({ hasText: 'Руководитель инженерной команды' });
  await expect(card).toBeVisible();
  await card.click();
  await page
    .getByRole('button', { name: 'Открыть STAR-истории' })
    .filter({ visible: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'STAR-истории' });
  await expect(dialog).toBeVisible();
  const background = await dialog.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  await expectAccessible(page);
  await expectNoOverflow(page);
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${evidenceDirectory}/${name}.png`, fullPage: true });
  writeFileSync(`${evidenceDirectory}/${name}.html`, await snapshotPage(page));
}

async function snapshotPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rules = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules, (rule) => rule.cssText);
      } catch {
        return [];
      }
    });
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('script, link[rel="stylesheet"], style')
      .forEach((node) => node.remove());
    const style = document.createElement('style');
    style.textContent = rules.join('\n');
    clone.querySelector('head')?.append(style);
    return `<!doctype html>${clone.outerHTML}`;
  });
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(
    result.violations
      .filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))
      .map((violation) => violation.id),
  ).toEqual([]);
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function editConfirmedStory(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Добавить историю' }).click();
  await page.getByLabel('Название истории').fill('Сокращение цикла релиза');
  await page
    .getByRole('textbox', { name: 'Ситуация', exact: true })
    .fill('Команда выпускала обновления раз в две недели.');
  await page
    .getByRole('textbox', { name: 'Задача', exact: true })
    .fill('Ускорить поставку и сохранить качество.');
  await page
    .getByRole('textbox', { name: 'Действие', exact: true })
    .fill('Автоматизировал выкладку и упростил проверку.');
  await page
    .getByRole('textbox', { name: 'Результат', exact: true })
    .fill('Сократил цикл релиза с 14 до 3 дней.');
  await expect(page.getByRole('alert')).toContainText('Числа в результате');
  await expect(page.getByRole('button', { name: 'Сохранить историю' })).toBeDisabled();
  await page
    .locator('.career-star-story-fact-option')
    .filter({ hasText: 'Сократил цикл релиза с 14 до 3 дней.' })
    .locator('input[type="checkbox"]')
    .check();
  await expect(page.getByText('Подтверждено выбранным фактом.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить историю' })).toBeEnabled();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Сохранить историю' }).click();
  await expect(page.getByRole('button', { name: 'Добавить историю' })).toBeVisible();
}

test('lists, creates, edits and opens linked STAR stories at 1440 and 390', async ({ browser }) => {
  test.setTimeout(90_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openStories(page, width);
      await expect(page.getByText('Нет STAR-историй')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Собрать с консультантом' })).toBeVisible();
      await capture(page, `${width}-star-stories-empty`);
      await editConfirmedStory(page);
      await expect(page.getByText('Сокращение цикла релиза')).toBeVisible();
      await expect(page.getByText('Подтверждено фактом')).toBeVisible();
      await expectAccessible(page);
      await capture(page, `${width}-star-stories-list`);
      await page.getByRole('link', { name: /Источник: Сократил цикл релиза/u }).click();
      await expect(page.locator('.career-star-story-source-text').first()).toContainText(
        'Сократил цикл релиза с 14 до 3 дней.',
      );
      await page.getByRole('button', { name: 'Править STAR-историю' }).click();
      await page
        .getByRole('textbox', { name: 'Действие', exact: true })
        .fill('Настроил автоматическую выкладку и проверки.');
      await capture(page, `${width}-star-stories-editor`);
      await page.getByRole('button', { name: 'Сохранить историю' }).click();
      await expect(page.getByRole('button', { name: 'Добавить историю' })).toBeVisible();
      await expect(page.getByText('Настроил автоматическую выкладку и проверки.')).toBeVisible();
      await page.getByRole('button', { name: 'Добавить историю' }).click();
      await page.getByLabel('Название истории').fill('Восстановление сервиса');
      await page
        .getByRole('textbox', { name: 'Ситуация', exact: true })
        .fill('Сервис стал недоступен.');
      await page
        .getByRole('textbox', { name: 'Задача', exact: true })
        .fill('Вернуть работу ключевого потока.');
      await page
        .getByRole('textbox', { name: 'Действие', exact: true })
        .fill('Собрал дежурную команду и устранил причину сбоя.');
      await page
        .getByRole('textbox', { name: 'Результат', exact: true })
        .fill('Сервис снова работает.');
      await page.getByRole('button', { name: 'Сохранить историю' }).click();
      await expect(page.getByRole('button', { name: 'Добавить историю' })).toBeVisible();
      await expect(page.getByText('Не подтверждено')).toBeVisible();
      await page.getByRole('button', { name: 'Закрыть STAR-истории' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const card = page
        .locator('.career-responses-card')
        .filter({ hasText: 'Руководитель инженерной команды' });
      await card.getByRole('button', { name: 'Подготовиться' }).click();
      const prepDialog = page.getByRole('dialog');
      await expect(prepDialog).toBeVisible();
      const prepBackground = await prepDialog.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(prepBackground).not.toBe('rgba(0, 0, 0, 0)');
      await prepDialog.getByRole('tab', { name: 'Вопросы к вам (STAR)' }).click();
      const openStoriesFromPrep = prepDialog.getByRole('button', {
        name: 'Открыть STAR-истории',
      });
      await expect(openStoriesFromPrep).toBeVisible();
      await capture(page, `${width}-star-stories-from-prep`);
      await openStoriesFromPrep.click();
      await expect(page.getByRole('dialog', { name: 'STAR-истории' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.getByRole('button', { name: 'Закрыть STAR-истории' }).click();
    } finally {
      await context.close();
    }
  }
});

test('opens the consultant from the empty STAR stories state', async ({ page }, info) => {
  test.skip(
    info.project.name !== 'desktop-1440',
    'This flow drives the requested viewports itself.',
  );
  await openStories(page, 390);
  await page.getByRole('button', { name: 'Собрать с консультантом' }).click();
  await expect(page.locator('aside.career-expert-panel')).toBeVisible();
  await expect(page.getByTestId('role-skill-assessment')).toHaveCount(0);
});
