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
const QUESTION = 'Название скрыто? Как называется компания на самом деле';
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

async function mockProfile(page: Page, places: Array<Record<string, unknown> & { id: string }>) {
  await mockSignedInCabinet(page, {
    careerDiary: { overview: {}, goals: [], workplace: null, profileExperiences: places },
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
  } else {
    await waitForCareerShell(page);
    await page.locator('.career-nav-button[aria-label="Профиль"]').first().click();
    await expect(page.locator('.career-profile-screen-view')).toBeVisible();
  }
  return answers;
}

async function open(page: Page, place: Record<string, unknown>) {
  const answers = await mockProfile(page, [{ ...place, id: 'exp-1' }]);
  if (isMobile(page)) {
    await page
      .locator('.pm-row')
      .filter({ has: page.getByText('Опыт', { exact: true }) })
      .click();
    await page.locator('.pm-row').filter({ hasNotText: 'Добавить место работы' }).first().click();
  } else {
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
    name: QUESTION,
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
  await expect(page.getByRole('textbox', { name: 'Настоящее название компании' })).toHaveValue(
    'Россети Цифра',
  );
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect.poll(() => answers).toEqual([{ employer: MASK, keepAsIs: true }]);
});

test('у настоящего названия вопроса нет', async ({ page }) => {
  await open(page, maskedPlace({ employer: 'Россети Цифра' }));
  await expect(page.getByText('Россети Цифра').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.profile-employer-name')).toHaveCount(0);
});

/** Работодатели профиля владельца на проде (10.11): три маски LinkedIn и три настоящих названия. */
const OWNER_PLACES = [
  ['OptiLab AI', '2025-01'],
  ['Enterprise Energy IT Services', '2023-04'],
  ['Enterprise Public Cloud Platform (IaaS / PaaS)', '2021-02'],
  ['Fishance Berhad', '2016-05'],
  ['Corporate University of a Top-Tier Financial Institution', '2012-09'],
  ['Kaspersky', '2010-03'],
].map(([employer, startDate], index) =>
  maskedPlace({
    id: `exp-${index + 1}`,
    employer,
    startDate,
    endDate: undefined,
    current: index === 0,
  }),
);

test('три маски владельца: вопрос сразу под шапкой компании, до пунктов (B640)', async ({
  page,
}) => {
  await mockProfile(page, OWNER_PLACES);
  if (isMobile(page)) {
    await page
      .locator('.pm-row')
      .filter({ has: page.getByText('Опыт', { exact: true }) })
      .click();
    await page.locator('.pm-row').filter({ hasText: 'Enterprise Public Cloud Platform' }).click();
    const question = page.getByRole('textbox', { name: QUESTION });
    await expect(question).toBeVisible();
    const [heroBottom, questionTop] = await Promise.all([
      page.locator('.pm-hero').evaluate((node) => node.getBoundingClientRect().bottom),
      page.locator('.profile-employer-name').evaluate((node) => node.getBoundingClientRect().top),
    ]);
    expect(questionTop).toBeGreaterThanOrEqual(heroBottom);
    expect(questionTop - heroBottom).toBeLessThan(40);
  } else {
    await page.getByRole('link', { name: 'Опыт', exact: true }).click();
    await expect(page.locator('.profile-employer-name')).toHaveCount(3);
    // Развёрнутое место: вопрос под шапкой (название, должность, метки) и до пунктов места.
    const order = await page
      .locator('.career-profile-screen-position:has(.profile-employer-name)')
      .evaluateAll((positions) =>
        positions.map((position) => {
          const children = [...position.children];
          const at = (selector: string) => children.findIndex((child) => child.matches(selector));
          return {
            head: at('.career-profile-screen-position-title-row'),
            question: at('.profile-employer-name'),
            last: children.length - 1,
            employer: position.querySelector('.profile-position-identity b')?.textContent,
          };
        }),
      );
    expect(order).toEqual([
      expect.objectContaining({ employer: 'Enterprise Energy IT Services', head: 0 }),
    ]);
    expect(order[0]!.question).toBeGreaterThan(order[0]!.head);
    expect(order[0]!.question).toBeLessThan(order[0]!.last);
    // Свёрнутые старые места: вопрос строкой под названием, без разворачивания.
    await expect(
      page.locator('.career-profile-screen-place-compact:has(.profile-employer-name) b'),
    ).toHaveText([
      'Enterprise Public Cloud Platform (IaaS / PaaS)',
      'Corporate University of a Top-Tier Financial Institution',
    ]);
  }
  await noHorizontalScroll(page);
  await page.locator('.profile-employer-name').first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(EVIDENCE, `${page.viewportSize()?.width}-b640-question-top.png`),
    fullPage: isMobile(page),
  });
});

test('«Проверка резюме»: «Название компании скрыто: 3 места» ведёт к первому вопросу (B640)', async ({
  page,
}) => {
  await mockProfile(page, OWNER_PLACES);
  if (isMobile(page)) {
    await page
      .locator('.pm-row')
      .filter({ has: page.getByText('Проверка', { exact: true }) })
      .click();
    const row = page.locator('.pm-row').filter({ hasText: 'Название компании скрыто: 3 места' });
    await expect(row).toBeVisible();
    await page.screenshot({ path: join(EVIDENCE, '390-b640-review.png'), fullPage: true });
    await row.click();
    await expect(page.locator('.pm-hero h2')).toHaveText('Enterprise Energy IT Services');
    await expect(page.getByRole('textbox', { name: QUESTION })).toBeVisible();
  } else {
    const review = page.locator('[data-review-block="experience"]');
    await review.scrollIntoViewIfNeeded();
    await review.getByRole('button', { name: /^Опыт: .*Показать список/u }).click();
    const remark = review.getByRole('button', { name: 'Название компании скрыто: 3 места.' });
    await expect(remark).toBeVisible();
    await page.screenshot({ path: join(EVIDENCE, '1440-b640-review.png') });
    await remark.click();
    const first = page.locator('.profile-employer-name input').first();
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
  }
});
