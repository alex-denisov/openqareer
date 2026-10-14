import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { mockSignedInCabinet, type MockCareerDiaryFixture } from './fixtures/mockSignedInCabinet';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';

const AS_OF = '2026-12-06';
const EVIDENCE = e2eEvidenceDirectory('AUD-10');

function workplace(startDate = '2026-10-18', status: 'active' | 'archived' = 'active') {
  return {
    id: 'workplace-1',
    company: 'Норма Групп',
    title: 'Head of Engineering',
    startDate,
    endDate: status === 'archived' ? '2026-12-01' : null,
    sourceExperienceId: 'experience-1',
    status,
    isPrimary: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-12-06T00:00:00.000Z',
  };
}

function goal(overrides: Record<string, unknown> = {}) {
  const id = String(overrides.id ?? 'goal-p1');
  return {
    id,
    title: 'Снизить число инцидентов P1',
    type: 'operational',
    horizon: 'quarter',
    startDate: '2026-10-01',
    dueDate: '2026-12-31',
    unit: 'инцидентов в месяц',
    baselineValue: 9,
    targetValue: 4,
    valueSource: 'candidate_entered',
    parentGoalId: null,
    isPrimary: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-12-01T00:00:00.000Z',
    latestMeasurement: {
      id: `measurement-${id}`,
      goalId: id,
      value: 9,
      measuredAt: '2026-12-01',
      note: null,
      source: 'candidate_entered',
      createdAt: '2026-12-01T12:00:00.000Z',
    },
    risk: {
      status: 'at_risk',
      rule: 'linear_progress_v1',
      explanation: 'По вашим замерам цель не достигается в срок.',
    },
    ...overrides,
  };
}

function fixture(
  options: {
    readonly startDate?: string;
    readonly status?: 'active' | 'archived';
    readonly planning?: Record<string, unknown>;
  } = {},
): MockCareerDiaryFixture {
  const place = {
    ...workplace(options.startDate, options.status),
    ...(options.planning ? { planning: options.planning } : {}),
  };
  const goals = [
    goal(),
    goal({
      id: 'goal-budget',
      title: 'Согласовать бюджет на Q1',
      unit: 'да/нет',
      baselineValue: null,
      targetValue: true,
      latestMeasurement: {
        id: 'measurement-budget',
        goalId: 'goal-budget',
        value: true,
        measuredAt: '2026-12-02',
        note: null,
        source: 'candidate_entered',
        createdAt: '2026-12-02T12:00:00.000Z',
      },
    }),
    goal({ id: 'goal-missing', title: 'Закрыть три вакансии в команде', latestMeasurement: null }),
    goal({ id: 'goal-next-quarter', horizon: 'next_quarter', dueDate: '2027-03-31' }),
  ];
  return {
    overview: {
      asOf: AS_OF,
      primaryWorkplace: place,
      summary: {
        goalsAchieved: 1,
        goalsAtRisk: 1,
        goalsTotal: goals.length,
        achievementsReadyToAdd: 0,
        weeklyReviewsTotal: 0,
        weeklyReviewsInRow: 0,
      },
    },
    goals,
    workplace: place,
    profileExperience: {
      id: 'experience-1',
      title: 'Head of Engineering',
      employer: 'Норма Групп',
      current: true,
    },
  };
}

async function openDiary(
  page: Page,
  testInfo: TestInfo,
  state: MockCareerDiaryFixture,
): Promise<string[]> {
  const unmatched = await mockSignedInCabinet(page, { careerDiary: state });
  await page.route('**/api/v1/coach/turn*', async (route) => replyToCoach(route));
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (testInfo.project.name === 'mobile-390') {
    const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
    await navigation.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('menuitem', { name: 'Карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await expect(page.locator('#career-diary-heading')).toBeVisible();
  return unmatched;
}

async function replyToCoach(route: Route): Promise<void> {
  await route.fulfill({
    json: {
      data: { message: 'По вашему плану стоит сначала согласовать цель и срок с руководителем.' },
    },
  });
}

async function openPlanningView(
  page: Page,
  testInfo: TestInfo,
  view: 'quarter' | 'adaptation',
): Promise<void> {
  if (testInfo.project.name === 'mobile-390') {
    await page
      .getByRole('button', { name: view === 'quarter' ? 'Итоги квартала' : 'План адаптации' })
      .click();
  } else {
    await page
      .getByRole('tab', { name: view === 'quarter' ? 'Анализ квартала' : 'План адаптации' })
      .click();
  }
}

async function capture(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  const main = page.locator('#career-main');
  await main.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: join(EVIDENCE, `${state}-${testInfo.project.name}.png`),
    fullPage: true,
  });
  const scrollable = await main.evaluate((element) => element.scrollHeight > element.clientHeight);
  if (scrollable) {
    await main.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.screenshot({
      path: join(EVIDENCE, `${state}-lower-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await main.evaluate((element) => {
      element.scrollTop = 0;
    });
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflowing).toBe(false);
}

test('calculates quarterly progress from measured goals and records the candidate choice', async ({
  page,
}, testInfo) => {
  const state = fixture();
  await openDiary(page, testInfo, state);
  await openPlanningView(page, testInfo, 'quarter');

  await expect(page.getByRole('heading', { name: 'Итоги Q4 2026' })).toBeVisible();
  await expect(page.getByText('1 из 3 целей достигнуто')).toBeVisible();
  await expect(page.getByText('50 %', { exact: true })).toBeVisible();
  await expect(page.getByText('По 2 из 3 целей есть замеры за квартал.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, 'quarter-summary');

  await page.getByRole('button', { name: 'Перенести в Q1 2027' }).first().click();
  await expect(page.getByText(/Перенесено в Q1 2027/u)).toBeVisible();

  await page.getByRole('button', { name: 'Оставить в Q4' }).first().click();
  await expect(page.getByText('Цель останется в Q4 2026.')).toBeVisible();
  await capture(page, testInfo, 'quarter-decisions');
});

test('launches an offer-stage plan, manages tasks, and asks the ordinary consultant with plan context', async ({
  page,
}, testInfo) => {
  const state = fixture({ startDate: '2026-12-20' });
  let coachPrompt = '';
  await mockSignedInCabinet(page, { careerDiary: state });
  await page.route('**/api/v1/coach/turn*', async (route) => {
    coachPrompt = String(route.request().postDataJSON().content ?? '');
    await replyToCoach(route);
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (testInfo.project.name === 'mobile-390') {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page.getByRole('menuitem', { name: 'Карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await openPlanningView(page, testInfo, 'adaptation');

  await expect(page.getByText(/Оффер принят: дата выхода 20 декабря 2026 г\./u)).toBeVisible();
  await capture(page, testInfo, 'offer-accepted');
  await page.getByRole('button', { name: 'Запустить план' }).click();
  await expect(page.getByRole('tab', { name: /Подготовка/u })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Выполнено 0 из 14 задач.')).toBeVisible();
  await capture(page, testInfo, 'adaptation-plan-launched');

  await page.getByRole('button', { name: 'Добавить задачу' }).click();
  await page.getByLabel('Название задачи').fill('Согласовать критерии успеха');
  await page.locator('#career-diary-adaptation-task-stage').selectOption('prep');
  await page.locator('#career-diary-adaptation-task-due').fill('2026-12-19');
  await page.getByRole('button', { name: 'Сохранить задачу' }).click();
  await expect(page.getByText('Согласовать критерии успеха')).toBeVisible();
  const firstTask = page.getByRole('checkbox', { name: /Аудит условий и ожиданий/u });
  await firstTask.click();
  await expect(firstTask).toBeChecked();
  await expect(page.getByText('Выполнено 1 из 15 задач.')).toBeVisible();

  await page.getByRole('button', { name: 'Обсудить план с консультантом' }).click();
  await expect(
    page.getByText('По вашему плану стоит сначала согласовать цель и срок с руководителем.'),
  ).toBeVisible();
  expect(coachPrompt).toContain('Норма Групп');
  expect(coachPrompt).toContain('Подготовка');
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, 'adaptation-plan-with-task');

  for (const stage of ['Дни 1–30', 'Дни 31–60', 'Дни 61–90']) {
    const stageTab = page.getByRole('tab', { name: new RegExp(stage, 'u') });
    await stageTab.click();
    await expect(stageTab).toHaveAttribute('aria-selected', 'true');
  }
  await capture(page, testInfo, 'adaptation-plan-stage-61-90');

  await page.getByRole('tab', { name: /Подготовка/u }).click();
  await page.getByRole('button', { name: 'Закрыть план' }).click();
  await expect(page.getByText('План адаптации закрыт')).toBeVisible();
  await capture(page, testInfo, 'adaptation-plan-closed');
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Назад к дневнику' }).click();
    await expect(page.locator('#career-diary-heading')).toBeVisible();
  }
});

test('shows the active 31–60 day stage when the start date was one to two months ago', async ({
  page,
}, testInfo) => {
  await openDiary(page, testInfo, fixture({ startDate: '2026-10-18' }));
  await openPlanningView(page, testInfo, 'adaptation');
  await page.getByRole('button', { name: 'Запустить план' }).click();
  await expect(page.getByRole('tab', { name: /Дни 31–60/u })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Адаптация: выход 1–2 месяца назад')).toBeVisible();
  await capture(page, testInfo, 'adaptation-days-31-60');
});

test('does not offer a new plan when the start date is more than 90 days old', async ({
  page,
}, testInfo) => {
  await openDiary(page, testInfo, fixture({ startDate: '2026-08-01' }));
  await openPlanningView(page, testInfo, 'adaptation');
  await expect(page.getByText(/Запустить план адаптации уже нельзя/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запустить план' })).toHaveCount(0);
  await capture(page, testInfo, 'adaptation-past-90');
});

test('keeps an archived workplace and its plan read-only', async ({ page }, testInfo) => {
  const state = fixture({
    startDate: '2026-10-18',
    status: 'archived',
    planning: {
      adaptationPlan: {
        id: 'plan-existing',
        workplaceId: 'workplace-1',
        startDate: '2026-10-18',
        createdAt: '2026-10-18T00:00:00.000Z',
        status: 'active',
        closedAt: null,
        tasks: [],
      },
    },
  });
  await openDiary(page, testInfo, state);
  await openPlanningView(page, testInfo, 'adaptation');
  await expect(
    page.getByRole('status').filter({ hasText: 'План доступен только для чтения' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить задачу' })).toHaveCount(0);
  await expect(page.getByText('Только для чтения', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'adaptation-archived');
});
