import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import {
  evaluateCareerGoalRisk,
  type CareerDiaryGoal,
  type CareerDiaryGoalInput,
  type CareerDiaryGoalSummary,
  type CareerDiaryMeasurement,
  type CareerDiaryMeasurementInput,
  type CareerDiaryOverview,
} from '../shared/careerDiary';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';

const DIARY_API = '/api/v1/candidate/career-diary';
const EVIDENCE = e2eEvidenceDirectory('B457');

type DiaryScenario = 'partial' | 'empty' | 'many';

interface DiaryHarness {
  scenario: DiaryScenario;
  measurements: CareerDiaryMeasurement[];
  extraGoals: CareerDiaryGoalSummary[];
  deferSummary: boolean;
  summaryGate: Promise<void>;
  releaseSummary: () => void;
  failGoalSave: boolean;
  failMeasurementSave: boolean;
}

const seedGoal: CareerDiaryGoal = {
  id: 'goal-release-days',
  title: 'Снизить время релиза',
  type: 'operational',
  horizon: 'quarter',
  startDate: '2026-10-01',
  dueDate: '2026-12-31',
  unit: 'дней',
  baselineValue: 20,
  targetValue: 10,
  valueSource: 'candidate_entered',
  parentGoalId: null,
  isPrimary: true,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
};

function createDiaryHarness(): DiaryHarness {
  let releaseSummary = () => undefined;
  const summaryGate = new Promise<void>((resolve) => {
    releaseSummary = resolve;
  });
  return {
    scenario: 'partial',
    measurements: [
      {
        id: 'measurement-1',
        goalId: seedGoal.id,
        value: 19.5,
        measuredAt: '2026-10-10',
        note: 'Первый замер',
        source: 'candidate_entered',
        createdAt: '2026-10-10T09:00:00.000Z',
      },
    ],
    extraGoals: [],
    deferSummary: false,
    summaryGate,
    releaseSummary,
    failGoalSave: false,
    failMeasurementSave: false,
  };
}

function summarizeGoal(
  goal: CareerDiaryGoal,
  measurements: CareerDiaryMeasurement[],
): CareerDiaryGoalSummary {
  const latest = measurements.filter((item) => item.goalId === goal.id).at(-1) ?? null;
  return {
    ...goal,
    latestMeasurement: latest,
    risk: evaluateCareerGoalRisk(goal, latest, '2026-10-10'),
  };
}

function goalsFor(state: DiaryHarness): CareerDiaryGoalSummary[] {
  if (state.scenario === 'empty') return [...state.extraGoals];
  if (state.scenario === 'many') {
    return Array.from({ length: 24 }, (_, index) => {
      const id = 'goal-' + String(index + 1);
      return summarizeGoal({ ...seedGoal, id, title: 'Цель ' + String(index + 1) }, []);
    });
  }
  return [summarizeGoal(seedGoal, state.measurements), ...state.extraGoals];
}

function overviewFor(state: DiaryHarness): CareerDiaryOverview {
  const goals = goalsFor(state);
  return {
    asOf: '2026-10-10',
    primaryWorkplace: null,
    summary: {
      goalsAchieved: goals.filter((goal) => goal.risk.status === 'achieved').length,
      goalsAtRisk: goals.filter((goal) => goal.risk.status === 'at_risk').length,
      goalsTotal: goals.length,
      achievementsReadyToAdd: 0,
      weeklyReviewsTotal: 0,
      weeklyReviewsInRow: 0,
    },
  };
}

function screenshotFile(testInfo: TestInfo, state: string): string {
  mkdirSync(EVIDENCE, { recursive: true });
  return join(EVIDENCE, state + '-' + testInfo.project.name + '.png');
}

async function serveOverview(route: Route, state: DiaryHarness): Promise<void> {
  if (state.deferSummary) await state.summaryGate;
  await route.fulfill({ json: { data: overviewFor(state) } });
}

async function serveGoals(route: Route, state: DiaryHarness): Promise<void> {
  const url = new URL(route.request().url());
  const cursor = url.searchParams.get('cursor');
  const goals = goalsFor(state);
  const items = cursor ? goals.slice(20) : goals.slice(0, 20);
  await route.fulfill({
    json: { data: { items, nextCursor: !cursor && goals.length > 20 ? 'page-2' : null } },
  });
}

async function saveMeasurement(route: Route, state: DiaryHarness, goalId: string): Promise<void> {
  if (state.failMeasurementSave) {
    await route.fulfill({
      status: 503,
      json: { error: { code: 'save_failed', message: 'Не удалось сохранить замер.' } },
    });
    return;
  }
  const input = route.request().postDataJSON() as CareerDiaryMeasurementInput;
  const measurement: CareerDiaryMeasurement = {
    ...input,
    id: 'measurement-' + String(state.measurements.length + 1),
    goalId,
    note: input.note ?? null,
    source: 'candidate_entered',
    createdAt: '2026-10-10T12:00:00.000Z',
  };
  state.measurements.push(measurement);
  await route.fulfill({ status: 201, json: { data: measurement } });
}

async function saveGoal(route: Route, state: DiaryHarness): Promise<void> {
  if (state.failGoalSave) {
    await route.fulfill({
      status: 503,
      json: { error: { code: 'save_failed', message: 'Не удалось сохранить цель.' } },
    });
    return;
  }
  const input = route.request().postDataJSON() as CareerDiaryGoalInput;
  const goal: CareerDiaryGoal = {
    ...input,
    id: 'goal-created',
    valueSource: 'candidate_entered',
    parentGoalId: input.parentGoalId ?? null,
    isPrimary: false,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
  };
  const summary = summarizeGoal(goal, []);
  state.extraGoals.push(summary);
  await route.fulfill({ status: 201, json: { data: summary } });
}

async function handleDiaryRoute(route: Route, state: DiaryHarness): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  const method = route.request().method();
  const parts = pathname.slice(DIARY_API.length).split('/').filter(Boolean);
  if (parts.length === 0 && method === 'GET') return serveOverview(route, state);
  if (parts[0] === 'goals' && parts.length === 1 && method === 'GET')
    return serveGoals(route, state);
  if (parts[0] === 'goals' && parts.length === 1 && method === 'POST')
    return saveGoal(route, state);
  if (parts[0] === 'goals' && parts.length === 3 && parts[2] === 'measurements') {
    if (method === 'GET')
      return route.fulfill({ json: { data: { items: state.measurements, nextCursor: null } } });
    if (method === 'POST') return saveMeasurement(route, state, parts[1]!);
  }
  if (parts[0] === 'goals' && parts.length === 2 && method === 'GET') {
    const goal = goalsFor(state).find((item) => item.id === parts[1]);
    return route.fulfill(
      goal ? { json: { data: goal } } : { status: 404, json: { error: { code: 'not_found' } } },
    );
  }
  if (['reviews', 'achievements', 'workplaces'].includes(parts[0] ?? '') && method === 'GET') {
    return route.fulfill({ json: { data: { items: [], nextCursor: null } } });
  }
  await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
}

async function installDiaryApi(page: Page, state: DiaryHarness): Promise<void> {
  await page.route('**/api/v1/candidate/career-diary**', (route) => handleDiaryRoute(route, state));
}

async function navigateDiary(page: Page, projectName: string): Promise<void> {
  if (projectName === 'mobile-390') {
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('menuitem', { name: 'Карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Карьерный дневник' })).toBeVisible();
}

async function openDiary(page: Page, testInfo: TestInfo, state: DiaryHarness): Promise<void> {
  await mockSignedInCabinet(page);
  await installDiaryApi(page, state);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await navigateDiary(page, testInfo.project.name);
}

async function captureDiary(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  await page.screenshot({ path: screenshotFile(testInfo, state), fullPage: true });
}

async function fillGoalForm(page: Page): Promise<void> {
  await page.getByLabel('Цель', { exact: true }).fill('Подготовить план найма');
  await page.getByLabel('Начало', { exact: true }).fill('2026-10-10');
  await page.getByLabel('Срок', { exact: true }).fill('2026-12-31');
  await page.getByLabel('Единица', { exact: true }).fill('команда');
  await page.getByLabel('Целевое значение', { exact: true }).fill('3');
}

test('opens the career diary from the desktop rail or mobile More menu', async ({
  page,
}, testInfo) => {
  const state = createDiaryHarness();
  await openDiary(page, testInfo, state);

  await expect(page.getByRole('button', { name: /Снизить время релиза/u })).toBeVisible();
  await expect(page.getByText('Под риском', { exact: true })).toBeVisible();
  await captureDiary(page, testInfo, 'partial-list');
});

test('records a measurement, updates goal risk, and sends its facts to the consultant', async ({
  page,
}, testInfo) => {
  const state = createDiaryHarness();
  await openDiary(page, testInfo, state);
  await page.getByRole('button', { name: /Снизить время релиза/u }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Снизить время релиза' })).toBeVisible();
  await expect(page.getByText('Под риском', { exact: true })).toBeVisible();
  await captureDiary(page, testInfo, 'goal-at-risk');

  await page.getByLabel('Значение, дней').fill('10');
  await page.getByLabel('Дата замера').fill('2026-10-10');
  await page.getByLabel('Комментарий').fill('Проверка после улучшения процесса');
  await page.getByRole('button', { name: 'Записать значение' }).click();
  await expect(page.getByText('Достигнуто', { exact: true })).toBeVisible();
  await captureDiary(page, testInfo, 'goal-achieved');

  await page.getByRole('button', { name: 'Спросить по этой цели' }).click();
  const input = page.getByRole('textbox', { name: 'Сообщение карьерному консультанту' });
  await expect(input).toHaveValue(/Снизить время релиза/u);
  const prompt = await input.inputValue();
  expect(prompt).toContain('Целевое значение: 10 дней.');
  expect(prompt).toContain('Последний замер от 2026-10-10: 10 дней');
  await captureDiary(page, testInfo, 'consultant-goal-context');
});

test('shows the loading and empty states', async ({ page }, testInfo) => {
  const state = createDiaryHarness();
  state.deferSummary = true;
  await openDiary(page, testInfo, state);
  await expect(page.getByRole('status')).toContainText('Загружаем сводку дневника');
  await captureDiary(page, testInfo, 'loading');
  state.releaseSummary();

  state.scenario = 'empty';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateDiary(page, testInfo.project.name);
  await expect(page.getByRole('heading', { level: 2, name: 'Целей пока нет' })).toBeVisible();
  await captureDiary(page, testInfo, 'empty');
});

test('loads more than twenty goals from the next page', async ({ page }, testInfo) => {
  const state = createDiaryHarness();
  state.scenario = 'many';
  await openDiary(page, testInfo, state);
  await expect(page.getByRole('button', { name: 'Цель 20' })).toBeVisible();
  await captureDiary(page, testInfo, 'many');
  await page.getByRole('button', { name: 'Показать ещё цели' }).click();
  await expect(page.getByRole('button', { name: 'Цель 24' })).toBeVisible();
});

test('creates a goal through the diary API', async ({ page }, testInfo) => {
  const state = createDiaryHarness();
  state.scenario = 'empty';
  await openDiary(page, testInfo, state);
  await page.getByRole('button', { name: 'Добавить цель' }).click();
  await fillGoalForm(page);
  await page.getByRole('button', { name: 'Сохранить цель' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Подготовить план найма' }),
  ).toBeVisible();
  await captureDiary(page, testInfo, 'goal-created');
});

test('keeps a recoverable form error visible after a failed save', async ({ page }, testInfo) => {
  const state = createDiaryHarness();
  state.failGoalSave = true;
  await openDiary(page, testInfo, state);
  await page.getByRole('button', { name: 'Добавить цель' }).click();
  await fillGoalForm(page);
  await captureDiary(page, testInfo, 'goal-form');
  await page.getByRole('button', { name: 'Сохранить цель' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await captureDiary(page, testInfo, 'save-error');
});
