import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet, type MockCareerDiaryFixture } from './fixtures/mockSignedInCabinet';

const AS_OF = '2026-12-06';
const EVIDENCE = e2eEvidenceDirectory('B460');

function workplace(id: string, company: string, title: string, sourceExperienceId: string | null) {
  return {
    id,
    company,
    title,
    startDate: '2026-10-01',
    endDate: null,
    sourceExperienceId,
    status: 'active',
    isPrimary: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-12-01T00:00:00.000Z',
  };
}

function diaryFixture(
  options: {
    readonly workplaces?: ReturnType<typeof workplace>[];
    readonly primaryId?: string;
    readonly profileExperience?: Record<string, unknown> & { id: string };
  } = {},
): MockCareerDiaryFixture {
  const workplaces = options.workplaces ?? [
    workplace('workplace-1', 'Норма Групп', 'Head of Engineering', 'experience-1'),
  ];
  const primary = workplaces.find((item) => item.id === (options.primaryId ?? workplaces[0]?.id));
  const marked = workplaces.map((item) => ({ ...item, isPrimary: item.id === primary?.id }));
  return {
    overview: {
      asOf: AS_OF,
      primaryWorkplace: primary ? { ...primary, isPrimary: true } : null,
      summary: {
        goalsAchieved: 0,
        goalsAtRisk: 0,
        goalsTotal: 0,
        achievementsReadyToAdd: 0,
        weeklyReviewsTotal: 0,
        weeklyReviewsInRow: 0,
      },
    },
    goals: [],
    workplace: primary ? { ...primary, isPrimary: true } : null,
    workplaces: marked,
    ...(options.profileExperience ? { profileExperience: options.profileExperience } : {}),
  };
}

function currentExperience(overrides: Record<string, unknown> = {}) {
  return {
    id: 'experience-1',
    chronologyMemoryId: 'memory-experience-1',
    title: 'Head of Engineering',
    employer: 'Норма Групп',
    current: true,
    startDate: '2026-10',
    bulletMemoryIds: [],
    ...overrides,
  };
}

async function openToday(page: Page, state?: MockCareerDiaryFixture): Promise<void> {
  await mockSignedInCabinet(page, state ? { careerDiary: state } : {});
  const diaryData = waitForDiaryInitialRequests(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible();
  await diaryData;
  await expect(page.locator('.career-diary-access-status[aria-busy="true"]')).toHaveCount(0);
}

function waitForDiaryInitialRequests(page: Page) {
  const paths = [
    '/api/v1/candidate/career-diary',
    '/api/v1/candidate/career-diary/workplaces',
    '/api/v1/candidate/resume',
  ];
  return Promise.all(
    paths.map((path) =>
      page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' && new URL(response.url()).pathname === path,
      ),
    ),
  );
}

async function capture(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  const main = page.locator('#career-main');
  await main.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: join(EVIDENCE, `${state}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
  const scrollable = await main.evaluate((element) => element.scrollHeight > element.clientHeight);
  if (scrollable) {
    await main.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.screenshot({
      path: join(EVIDENCE, `${state}-lower-${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await main.evaluate((element) => {
      element.scrollTop = 0;
    });
  }
}

test('hides the diary entry points when the profile has no current work', async ({
  page,
}, testInfo) => {
  await openToday(
    page,
    diaryFixture({
      workplaces: [workplace('workplace-old', 'Норма Групп', 'Head of Engineering', null)],
      profileExperience: currentExperience({ current: false, endDate: '2026-10-01' }),
    }),
  );
  await expect(page.getByRole('button', { name: 'Открыть карьерный дневник' })).toHaveCount(0);
  if (testInfo.project.name === 'mobile-390') {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Карьерный дневник' })).toHaveCount(0);
  } else {
    const diaryButton = page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' });
    await expect(diaryButton).toBeDisabled();
    await expect(diaryButton).toHaveAttribute('aria-label', /В профиле нет текущего места работы/u);
  }
  await capture(page, testInfo, 'not-working-hidden');
});

test('creates the first diary from the current profile experience', async ({ page }, testInfo) => {
  await openToday(
    page,
    diaryFixture({
      workplaces: [],
      profileExperience: currentExperience({ startDate: '2026-10-01' }),
    }),
  );
  if (testInfo.project.name === 'mobile-390') {
    await expect(page.getByRole('button', { name: 'Открыть карьерный дневник' })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await page.getByRole('button', { name: 'Создать дневник' }).click();
  await page.getByLabel('Дата начала').fill('2026-10-01');
  await capture(page, testInfo, 'create-diary-from-profile');
  await page.getByRole('button', { name: 'Создать дневник', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Норма Групп', level: 2 })).toBeVisible();
  await expect(page.getByText('Head of Engineering', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'first-diary-active');
});

test('shows loading and error status before offering the diary link', async ({
  page,
}, testInfo) => {
  const state = diaryFixture({ profileExperience: currentExperience() });
  await mockSignedInCabinet(page, { careerDiary: state });
  let releaseFailure!: () => void;
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  let failedOnce = false;
  await page.route('**/api/v1/candidate/career-diary', async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await failureGate;
      await route.fulfill({
        status: 503,
        json: { error: { message: 'Сервис дневника временно недоступен.' } },
      });
      return;
    }
    await route.fallback();
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (testInfo.project.name === 'desktop-1440') {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await expect(
    page.getByText(
      testInfo.project.name === 'mobile-390'
        ? 'Проверяем статус места работы…'
        : 'Проверяем место работы из профиля…',
    ),
  ).toBeVisible({ timeout: 15_000 });
  await capture(page, testInfo, 'availability-loading');
  releaseFailure();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Сервис дневника временно недоступен.' }),
  ).toBeVisible();
  await capture(page, testInfo, 'availability-error');
  await page.getByRole('button', { name: 'Повторить' }).click();
  if (testInfo.project.name === 'mobile-390') {
    await expect(page.getByRole('button', { name: 'Открыть карьерный дневник' })).toBeVisible();
  } else {
    await expect(
      page
        .getByRole('navigation', { name: 'Разделы кабинета' })
        .getByRole('button', { name: 'Карьерный дневник' }),
    ).toBeEnabled();
  }
});

test('opens the diary from Today and the desktop rail or mobile More menu', async ({
  page,
}, testInfo) => {
  await openToday(page, diaryFixture({ profileExperience: currentExperience() }));
  if (testInfo.project.name === 'mobile-390') {
    await expect(page.getByRole('button', { name: 'Открыть карьерный дневник' })).toBeVisible();
  } else {
    await expect(
      page
        .getByRole('navigation', { name: 'Разделы кабинета' })
        .getByRole('button', { name: 'Карьерный дневник' }),
    ).toBeEnabled();
  }
  if (testInfo.project.name === 'mobile-390') {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Карьерный дневник' })).toBeVisible();
    await page.keyboard.press('Escape');
  } else {
    await expect(
      page
        .getByRole('navigation', { name: 'Разделы кабинета' })
        .getByRole('button', { name: 'Карьерный дневник' }),
    ).toBeVisible();
  }
  await capture(page, testInfo, 'diary-entry-today');
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Открыть карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await expect(page.locator('#career-diary-heading')).toBeVisible();
  await capture(page, testInfo, 'diary-active');
});

test('offers an explicit choice when the linked profile role changed', async ({
  page,
}, testInfo) => {
  const state = diaryFixture({
    profileExperience: currentExperience({ title: 'VP Engineering' }),
  });
  await openToday(page, state);
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Открыть карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  const dialog = page.getByRole('dialog', { name: 'Роль в профиле изменилась' });
  await expect(dialog).toBeVisible();
  await capture(page, testInfo, 'profile-role-changed');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('VP Engineering', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'profile-role-kept');
});

test('starts a separate diary with the actual role start date', async ({ page }, testInfo) => {
  const state = diaryFixture({
    profileExperience: currentExperience({ title: 'VP Engineering' }),
  });
  await openToday(page, state);
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Открыть карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await page.getByLabel('Начать новый дневник').check();
  await page.getByLabel('Дата выхода на новую роль').fill('2026-12-20');
  await capture(page, testInfo, 'start-new-diary-choice');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('dialog', { name: 'Роль в профиле изменилась' })).toHaveCount(0);
  await expect(page.getByText('VP Engineering', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сменить основное место' })).toHaveCount(0);
  await capture(page, testInfo, 'new-diary-active');
});

test('switches the primary workplace using the saved profile places', async ({
  page,
}, testInfo) => {
  const places = [
    workplace('workplace-1', 'Норма Групп', 'Head of Engineering', 'experience-1'),
    workplace('workplace-2', 'Север', 'VP Product', 'experience-2'),
    ...Array.from({ length: 4 }, (_, index) =>
      workplace(`workplace-${index + 3}`, `Компания ${index + 3}`, `Роль ${index + 3}`, null),
    ),
  ];
  await openToday(
    page,
    diaryFixture({
      workplaces: places,
      primaryId: 'workplace-1',
      profileExperience: currentExperience(),
    }),
  );
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Открыть карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await page.getByRole('button', { name: 'Сменить основное место' }).click();
  const dialog = page.getByRole('dialog', { name: 'Какое место основное?' });
  await expect(dialog.getByRole('radio')).toHaveCount(6);
  await capture(page, testInfo, 'primary-place-many');
  await dialog.getByRole('radio', { name: /Север\. VP Product/u }).check();
  await dialog.getByRole('button', { name: 'Сделать основным' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Север' })).toBeVisible();
  await capture(page, testInfo, 'primary-place-changed');
});
