import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import {
  evaluateCareerGoalRisk,
  type CareerDiaryGoal,
  type CareerDiaryGoalInput,
  type CareerDiaryGoalPatch,
  type CareerDiaryGoalSummary,
  type CareerDiaryMeasurement,
  type CareerDiaryMeasurementInput,
  type CareerDiaryOverview,
} from '../shared/careerDiary';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { verifiedCareerDiaryFixture, verifiedDiaryWorkplace } from './fixtures/verifiedCareerDiary';

const DIARY_API = '/api/v1/candidate/career-diary';
const EVIDENCE = e2eEvidenceDirectory('AUD-10');

type DiaryScenario = 'partial' | 'empty' | 'many';

interface DiaryHarness {
  scenario: DiaryScenario;
  measurements: CareerDiaryMeasurement[];
  extraGoals: CareerDiaryGoalSummary[];
  editedGoal: CareerDiaryGoalSummary | null;
  deletedGoalId: string | null;
  splitGoals: CareerDiaryGoalSummary[];
  deferSummary: boolean;
  overviewRequests: number;
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
    editedGoal: null,
    deletedGoalId: null,
    splitGoals: [],
    deferSummary: false,
    overviewRequests: 0,
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
  if (state.scenario === 'empty') return [...state.extraGoals, ...state.splitGoals];
  if (state.scenario === 'many') {
    return Array.from({ length: 24 }, (_, index) => {
      const id = 'goal-' + String(index + 1);
      return summarizeGoal({ ...seedGoal, id, title: 'Цель ' + String(index + 1) }, []);
    });
  }
  const goal = state.editedGoal ?? summarizeGoal(seedGoal, state.measurements);
  return [
    ...(state.deletedGoalId === goal.id ? [] : [goal]),
    ...state.splitGoals,
    ...state.extraGoals,
  ];
}

function overviewFor(state: DiaryHarness): CareerDiaryOverview {
  const goals = goalsFor(state);
  return {
    asOf: '2026-10-10',
    primaryWorkplace: verifiedDiaryWorkplace,
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
  const requestNumber = state.overviewRequests++;
  if (state.deferSummary && requestNumber > 0) await state.summaryGate;
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
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const method = request.method();
  const parts = pathname.slice(DIARY_API.length).split('/').filter(Boolean);
  if (parts.length === 0 && method === 'GET') return serveOverview(route, state);
  if (await handleGoalRoute(route, state, parts, method)) return;
  if (
    ['reviews', 'achievements', 'workplaces', 'interview-practices'].includes(parts[0] ?? '') &&
    method === 'GET'
  ) {
    return route.fulfill({ json: { data: { items: [], nextCursor: null } } });
  }
  await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
}

async function handleGoalRoute(
  route: Route,
  state: DiaryHarness,
  parts: string[],
  method: string,
): Promise<boolean> {
  if (parts[0] !== 'goals') return false;
  if (parts.length === 1 && method === 'GET') return serveGoalsResult(route, state);
  if (parts.length === 1 && method === 'POST') {
    await saveGoal(route, state);
    return true;
  }
  if (parts.length === 2) return handleSingleGoal(route, state, parts[1]!, method);
  if (parts.length === 3 && parts[2] === 'measurements')
    return handleMeasurements(route, state, parts[1]!, method);
  if (parts.length === 3 && parts[2] === 'split' && method === 'POST')
    return splitGoal(route, state, parts[1]!);
  return false;
}

async function serveGoalsResult(route: Route, state: DiaryHarness): Promise<boolean> {
  await serveGoals(route, state);
  return true;
}

async function handleSingleGoal(
  route: Route,
  state: DiaryHarness,
  goalId: string,
  method: string,
): Promise<boolean> {
  if (method === 'GET') {
    const goal = goalsFor(state).find((item) => item.id === goalId);
    await route.fulfill(
      goal ? { json: { data: goal } } : { status: 404, json: { error: { code: 'not_found' } } },
    );
    return true;
  }
  if (method === 'PATCH') return updateGoal(route, state);
  if (method === 'DELETE') return deleteGoal(route, state, goalId);
  return false;
}

async function updateGoal(route: Route, state: DiaryHarness): Promise<boolean> {
  const patch = route.request().postDataJSON() as CareerDiaryGoalPatch;
  const current = state.editedGoal ?? summarizeGoal(seedGoal, state.measurements);
  const updated = summarizeGoal(
    { ...current, ...patch, updatedAt: '2026-10-10T13:00:00.000Z' },
    state.measurements,
  );
  state.editedGoal = updated;
  await route.fulfill({ json: { data: updated } });
  return true;
}

async function deleteGoal(route: Route, state: DiaryHarness, goalId: string): Promise<boolean> {
  state.deletedGoalId = goalId;
  await route.fulfill({ json: { data: { id: goalId, deleted: true } } });
  return true;
}

async function splitGoal(route: Route, state: DiaryHarness, goalId: string): Promise<boolean> {
  const input = route.request().postDataJSON() as { children: CareerDiaryGoalInput[] };
  state.splitGoals = input.children.map((child, index) =>
    summarizeGoal(
      {
        ...child,
        id: 'goal-split-' + String(index + 1),
        valueSource: 'candidate_entered',
        parentGoalId: goalId,
        isPrimary: false,
        createdAt: '2026-10-10T13:00:00.000Z',
        updatedAt: '2026-10-10T13:00:00.000Z',
      },
      [],
    ),
  );
  await route.fulfill({ status: 201, json: { data: state.splitGoals } });
  return true;
}

async function handleMeasurements(
  route: Route,
  state: DiaryHarness,
  goalId: string,
  method: string,
): Promise<boolean> {
  if (method === 'GET') return listMeasurements(route, state);
  if (method === 'POST') {
    await saveMeasurement(route, state, goalId);
    return true;
  }
  return false;
}

async function listMeasurements(route: Route, state: DiaryHarness): Promise<boolean> {
  const cursor = new URL(route.request().url()).searchParams.get('cursor');
  const offset = cursor ? 20 : 0;
  const items = state.measurements.slice(offset, offset + 20);
  const nextCursor =
    offset + items.length < state.measurements.length ? 'measurements-page-2' : null;
  await route.fulfill({ json: { data: { items, nextCursor } } });
  return true;
}

async function installDiaryApi(page: Page, state: DiaryHarness): Promise<void> {
  await page.route('**/api/v1/candidate/career-diary**', (route) => handleDiaryRoute(route, state));
}

async function navigateDiary(page: Page, projectName: string): Promise<void> {
  if (projectName === 'mobile-390') {
    const nav = page.getByRole('navigation', { name: 'Разделы' });
    await nav.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('menuitem', { name: 'Карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await expect(page.locator('#career-diary-heading')).toBeVisible();
}

async function openDiary(page: Page, testInfo: TestInfo, state: DiaryHarness): Promise<void> {
  await mockSignedInCabinet(page, { careerDiary: verifiedCareerDiaryFixture('2026-10-10') });
  await installDiaryApi(page, state);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await navigateDiary(page, testInfo.project.name);
}

async function captureDiary(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  await page.screenshot({ path: screenshotFile(testInfo, state), fullPage: true });
}

async function captureDiaryHarness(page: Page, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  const html = await page.evaluate(() => {
    const styles = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    const root = document.querySelector('#root')?.innerHTML ?? '';
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>${root}</body></html>`;
  });
  writeFileSync(join(EVIDENCE, `app-harness-${testInfo.project.name}.html`), html, 'utf8');
}

async function fillGoalForm(page: Page): Promise<void> {
  await page.getByLabel('Цель', { exact: true }).fill('Подготовить план найма');
  await page.getByLabel('Тип', { exact: true }).selectOption('team');
  await page.getByLabel('Горизонт', { exact: true }).selectOption('quarter');
  await page.getByLabel('Начало', { exact: true }).fill('2026-10-10');
  await page.getByLabel('Срок', { exact: true }).fill('2026-12-31');
  await page.getByLabel('Единица', { exact: true }).fill('команда');
  await page.getByLabel('Формат цели', { exact: true }).selectOption('number');
  await page.getByLabel('Исходное значение', { exact: true }).fill('2');
  await page.getByLabel('Целевое значение', { exact: true }).fill('3');
}

test('opens the career diary from the desktop rail or mobile More menu', async ({
  page,
}, testInfo) => {
  const state = createDiaryHarness();
  await openDiary(page, testInfo, state);

  await expect(page.getByRole('button', { name: /Снизить время релиза/u })).toBeVisible();
  await expect(page.getByText('Под риском', { exact: true })).toBeVisible();
  await captureDiaryHarness(page, testInfo);
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

test('loads more than twenty measurements from the goal history', async ({ page }, testInfo) => {
  const state = createDiaryHarness();
  state.measurements = Array.from({ length: 24 }, (_, index) => ({
    id: `measurement-${index + 1}`,
    goalId: seedGoal.id,
    value: 19.5 - index / 2,
    measuredAt: '2026-10-10',
    note: `Замер ${index + 1}`,
    source: 'candidate_entered' as const,
    createdAt: `2026-10-10T${String(index).padStart(2, '0')}:00:00.000Z`,
  }));
  await openDiary(page, testInfo, state);
  await page.getByRole('button', { name: /Снизить время релиза/u }).click();
  const rows = page.locator('.career-diary-history__table tbody tr');
  await expect(rows).toHaveCount(20);
  await page.getByRole('button', { name: 'Показать ещё замеры' }).click();
  await expect(rows).toHaveCount(24);
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
  expect(state.extraGoals[0]).toMatchObject({
    type: 'team',
    horizon: 'quarter',
    baselineValue: 2,
    targetValue: 3,
  });
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

test('updates a goal, keeps it after reload, and deletes it through the diary API', async ({
  page,
}, testInfo) => {
  const state = createDiaryHarness();
  await openDiary(page, testInfo, state);
  await page.getByRole('button', { name: /Снизить время релиза/u }).click();
  await page.getByRole('button', { name: 'Изменить цель' }).click();
  await page.getByLabel('Цель', { exact: true }).fill('Снизить время релиза к концу года');
  await page.getByRole('button', { name: 'Сохранить цель' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Снизить время релиза к концу года' }),
  ).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateDiary(page, testInfo.project.name);
  await expect(
    page.getByRole('button', { name: /Снизить время релиза к концу года/u }),
  ).toBeVisible();

  await page.getByRole('button', { name: /Снизить время релиза к концу года/u }).click();
  await page.getByRole('button', { name: 'Изменить цель' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Удалить цель' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Целей пока нет' })).toBeVisible();
  expect(state.deletedGoalId).toBe(seedGoal.id);
});

test('splits a goal into two candidate-owned subgoals through the diary API', async ({
  page,
}, testInfo) => {
  const state = createDiaryHarness();
  await openDiary(page, testInfo, state);
  await page.getByRole('button', { name: /Снизить время релиза/u }).click();
  await page.getByRole('button', { name: 'Разбить цель' }).click();
  const dialog = page.getByRole('dialog', { name: 'Разбить цель' });
  await dialog.getByLabel('Название подцели 1').fill('Снизить время релиза до 14 дней');
  await dialog.getByLabel('Целевое значение подцели 1').fill('14');
  await dialog.getByLabel('Срок подцели 1').fill('2026-11-15');
  await dialog.getByLabel('Название подцели 2').fill('Снизить время релиза до 10 дней');
  await dialog.getByLabel('Дата начала подцели 2').fill('2026-11-16');
  await dialog.getByLabel('Целевое значение подцели 2').fill('10');
  await dialog.getByLabel('Срок подцели 2').fill('2026-12-31');
  await dialog.getByRole('button', { name: 'Сохранить разбиение' }).click();
  await expect(page.getByRole('status')).toContainText('Цель разбита на 2 подцели');
  expect(state.splitGoals.map((goal) => goal.parentGoalId)).toEqual([seedGoal.id, seedGoal.id]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateDiary(page, testInfo.project.name);
  await expect(
    page.getByRole('button', { name: /Снизить время релиза до 14 дней/u }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Снизить время релиза до 10 дней/u }),
  ).toBeVisible();
});
