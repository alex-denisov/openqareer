import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { waitForCareerShell } from './helpers/waitForCareerShell';

/**
 * B639: под маской работодателя из LinkedIn «Профиль» спрашивает настоящее название компании.
 * Ответ уходит одним запросом; сохранённое название можно изменить или убрать. 1440 и 390.
 */
const MASK = 'Enterprise Energy IT Services';
const EVIDENCE = e2eEvidenceDirectory('B639');
test.beforeAll(() => mkdirSync(EVIDENCE, { recursive: true }));

function maskedPlace(extra: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    chronologyMemoryId: 'm-resp-1',
    title: 'VP of Technology',
    employer: MASK,
    location: 'Москва',
    startDate: '2023-04',
    endDate: '2025-10',
    current: false,
    bulletMemoryIds: ['m-out-1'],
    ...extra,
  };
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 761;

async function open(page: Page, place: Record<string, unknown>) {
  await mockSignedInCabinet(page, {
    careerDiary: {
      overview: {},
      goals: [],
      workplace: null,
      profileExperience: { ...place, id: 'exp-1' },
    },
  });
  const answers: unknown[] = [];
  await page.route('**/api/v1/candidate/experience/employer-name', async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { memory: null }, meta: { requestId: 'b639' } } });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (isMobile(page)) {
    await page
      .locator('.career-mobile-nav')
      .getByRole('button', { name: 'Профиль', exact: true })
      .click();
    await page
      .locator('.pm-row')
      .filter({ has: page.getByText('Опыт', { exact: true }) })
      .click();
    await page.locator('.pm-row').filter({ hasNotText: 'Добавить место работы' }).first().click();
  } else {
    await waitForCareerShell(page);
    await page.locator('.career-nav-button[aria-label="Профиль"]').first().click();
    await expect(page.locator('.career-profile-screen-view')).toBeVisible();
    await page.getByRole('link', { name: 'Опыт', exact: true }).click();
  }
  return answers;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('маска — вопрос о названии, ответ уходит одним запросом', async ({ page }) => {
  const answers = await open(page, maskedPlace());
  const question = page.getByRole('textbox', {
    name: 'Как называется эта компания на самом деле?',
  });
  await expect(question).toBeVisible();
  await question.scrollIntoViewIfNeeded();
  await noHorizontalScroll(page);
  await page.screenshot({
    path: join(EVIDENCE, `${page.viewportSize()?.width}-question.png`),
    fullPage: isMobile(page),
  });

  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.profile-employer-name').getByRole('alert')).toHaveText(
    'Напишите название компании.',
  );
  expect(answers).toEqual([]);

  await question.fill('Россети Цифра');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => answers).toEqual([{ employer: MASK, name: 'Россети Цифра' }]);
});

test('«Это и есть название» снимает вопрос', async ({ page }) => {
  const answers = await open(page, maskedPlace());
  await page.getByRole('button', { name: 'Это и есть название', exact: true }).click();
  await expect.poll(() => answers).toEqual([{ employer: MASK, keepAsIs: true }]);
});

test('сохранённое название видно, его можно изменить и убрать', async ({ page }) => {
  const answers = await open(
    page,
    maskedPlace({ employerRealName: 'Россети Цифра', employerNameMemoryId: 'm-name' }),
  );
  await expect(page.getByText('Настоящее название:')).toBeVisible();
  await expect(page.locator('.profile-employer-name__saved b')).toHaveText('Россети Цифра');
  await noHorizontalScroll(page);
  await page.locator('.profile-employer-name').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(EVIDENCE, `${page.viewportSize()?.width}-saved.png`),
    fullPage: isMobile(page),
  });
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Как называется эта компания на самом деле?' }),
  ).toHaveValue('Россети Цифра');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect.poll(() => answers).toEqual([{ employer: MASK, keepAsIs: true }]);
});

test('у настоящего названия вопроса нет', async ({ page }) => {
  await open(page, maskedPlace({ employer: 'Россети Цифра' }));
  await expect(page.getByText('Россети Цифра').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.profile-employer-name')).toHaveCount(0);
});
