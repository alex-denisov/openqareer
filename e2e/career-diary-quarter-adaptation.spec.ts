import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { CandidateSnapshot, CoachResult } from '../src/features/coach/coachApi';
import { join } from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import {
  mockSignedInCabinet,
  mockProfileSnapshot,
  mockCareerDiaryRoutes,
  type MockCareerDiaryFixture,
} from './fixtures/mockSignedInCabinet';
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
    const navigation = page.getByRole('navigation', { name: 'Разделы' });
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

async function navigateToDiary(page: Page, info: TestInfo) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (info.project.name === 'mobile-390') {
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page.getByRole('menuitem', { name: 'Карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await expect(page.locator('#career-diary-heading')).toBeVisible();
}

async function replyToCoach(route: Route): Promise<void> {
  await route.fulfill({
    json: {
      data: {
        message: 'По вашему плану стоит сначала согласовать цель и срок с руководителем.',
        phase: 'discovery',
        nextQuestion: null,
        completeness: { known: [], unknown: [] },
        safety: { needsHuman: false, reason: null },
        careerTrack: null,
        actionProposals: [],
      },
    },
  });
}

async function installAdaptationDialogue(
  page: Page,
  state: MockCareerDiaryFixture,
  mode: 'create' | 'edit' = 'create',
) {
  await page.route('**/api/v1/candidate/career-diary/**', async (route) => {
    if (!(await mockCareerDiaryRoutes(route, new URL(route.request().url()).pathname, state)))
      await route.fallback();
  });
  const messages: CandidateSnapshot['messages'] = [],
    turns: CandidateSnapshot['turns'] = [];
  let applied = false,
    loseSaveResponse = true;
  let delayNext = false;
  let release: (() => void) | undefined;
  const requests: Array<{
    stage: string;
    content: string;
    subject: { kind: string; id: string; planId: string; adaptationStage: 'prep' };
  }> = [];
  await page.route('**/api/v1/candidate/me**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/candidate/me') && url.searchParams.get('stage') !== 'diary')
      return route.fallback();
    if (url.pathname.endsWith('/messages'))
      return route.fulfill({ json: { data: messages, meta: { nextOffset: null } } });
    return route.fulfill({
      json: {
        data: { ...mockProfileSnapshot(state), messages, turns },
        meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
      },
    });
  });
  await page.route('**/api/v1/coach/turn*', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (delayNext) {
      delayNext = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    const place = state.workplace!;
    const context = {
      workplaceId: place.id,
      planId: body.subject.planId,
      stage: body.subject.adaptationStage,
      version: createHash('sha256').update(JSON.stringify(place)).digest('hex'),
      label: 'Норма Групп · Head of Engineering · Подготовка',
      readOnly: false,
    };
    const message =
      requests.length === 1
        ? 'Какой результат от вас ожидают в первый месяц?'
        : 'Ожидания пока неизвестны. Предлагаю сначала согласовать критерий результата.';
    const result: CoachResult = {
      message,
      phase: 'discovery',
      nextQuestion: null,
      completeness: { known: [], unknown: ['Ожидаемый результат'] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [],
      adaptationContext: context,
      adaptationTask:
        requests.length > 1
          ? {
              targetTaskId:
                mode === 'edit'
                  ? (
                      state.workplace!.planning as {
                        adaptationPlan: { tasks: Array<{ id: string }> };
                      }
                    ).adaptationPlan.tasks[0]!.id
                  : null,
              title: 'Уточнить ожидаемый результат',
              description: 'Согласовать критерий готовности с руководителем.',
              dueDate: null,
            }
          : null,
    };
    messages.push(
      { id: body.messageId, role: 'user', content: body.content },
      { id: randomUUID(), role: 'assistant', content: result.message },
    );
    turns.push({
      idempotencyKey: route.request().headers()['idempotency-key']!,
      phase: 'discovery',
      status: 'completed',
      result,
      provenance: {
        provider: 'fixture',
        model: 'fixture',
        responseId: 'fixture',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      createdAt: '2026-12-06T12:00:00.000Z',
      updatedAt: '2026-12-06T12:00:00.000Z',
    });
    return route.fulfill({ json: { data: result } });
  });
  await page.route('**/api/v1/coach/adaptation-context/*', (route) =>
    route.fulfill({ json: { data: { stale: false, readOnly: false } } }),
  );
  await page.route('**/api/v1/coach/adaptation-proposals/*', async (route) => {
    if (route.request().method() === 'GET') {
      const target =
        mode === 'edit'
          ? (
              state.workplace!.planning as {
                adaptationPlan: { tasks: Array<Record<string, unknown>> };
              }
            ).adaptationPlan.tasks[0]
          : null;
      return route.fulfill({
        json: { data: { status: applied ? 'applied' : 'available', target } },
      });
    }
    const edits = route.request().postDataJSON();
    if (!applied) {
      const planning = state.workplace!.planning as {
        adaptationPlan: { tasks: Array<Record<string, unknown>> };
      };
      if (mode === 'edit') Object.assign(planning.adaptationPlan.tasks[0]!, edits);
      else
        planning.adaptationPlan.tasks.push({
          ...edits,
          id: 'coach-fixture-task',
          completed: false,
          stage: 'prep',
          category: 'alignment',
          source: 'candidate',
        });
      applied = true;
    }
    if (loseSaveResponse) {
      loseSaveResponse = false;
      return route.abort('failed');
    }
    return route.fulfill({ json: { data: state.workplace } });
  });
  return {
    requests,
    isApplied: () => applied,
    deferNext: () => {
      delayNext = true;
    },
    release: () => release?.(),
  };
}

test('B357 continues the diary dialogue, confirms an edited task after a lost response and reloads history', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const state = fixture({ startDate: '2026-12-20' });
  await mockSignedInCabinet(page, { careerDiary: state });
  const server = await installAdaptationDialogue(page, state);
  await navigateToDiary(page, info);
  await openPlanningView(page, info, 'adaptation');
  await page.getByRole('button', { name: 'Запустить план', exact: true }).click();
  await page.getByRole('button', { name: 'Обсудить план с консультантом' }).click();
  expect(server.requests).toHaveLength(0);
  const panel = page.getByRole(info.project.name === 'mobile-390' ? 'dialog' : 'complementary', {
    name: /Консультант · Карьерный дневник/u,
  });
  const input = panel.getByLabel('Сообщение карьерному консультанту');
  await input.fill('Как начать адаптацию?');
  await panel.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
  await expect(panel.getByText('Какой результат от вас ожидают в первый месяц?')).toBeVisible();
  await input.fill('Пока не знаю');
  await panel.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
  await expect(
    panel.getByText('Ожидания пока неизвестны. Предлагаю сначала согласовать критерий результата.'),
  ).toBeVisible();
  expect(server.requests.map((request) => request.stage)).toEqual(['diary', 'diary']);
  expect(server.requests[1]!.subject).toMatchObject({
    kind: 'adaptation',
    adaptationStage: 'prep',
  });
  expect(server.isApplied()).toBe(false);
  const proposal = panel.getByRole('region', { name: 'Предложение задачи адаптации' });
  await proposal.getByRole('button', { name: 'Изменить предложение' }).click();
  await proposal.getByLabel('Название задачи').fill('Согласовать критерий успеха до выхода');
  await proposal.getByLabel('Срок задачи').fill('2026-12-19');
  await proposal.getByRole('button', { name: 'Добавить задачу в план' }).click();
  await expect(proposal.getByRole('alert')).toBeVisible();
  await expect(proposal.getByText('Изменение плана сохранено.')).toHaveCount(0);
  await proposal.getByRole('button', { name: 'Добавить задачу в план' }).click();
  await expect(proposal.getByText('Изменение плана сохранено.')).toBeVisible();
  const tasks = (
    state.workplace!.planning as { adaptationPlan: { tasks: Array<{ title: string }> } }
  ).adaptationPlan.tasks;
  expect(
    tasks.filter((task) => task.title === 'Согласовать критерий успеха до выхода'),
  ).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
  const violations = (
    await new AxeBuilder({ page }).include('.career-expert-panel').analyze()
  ).violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''));
  expect(violations).toEqual([]);
  mkdirSync('output/B357/browser', { recursive: true });
  await page.screenshot({ path: `output/B357/browser/dialogue-${info.project.name}.png` });
  const html = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, link[rel="stylesheet"]').forEach((node) => node.remove());
    const style = document.createElement('style');
    style.textContent = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    clone.querySelector('head')?.append(style);
    return '<!doctype html>' + clone.outerHTML;
  });
  writeFileSync(`output/B357/browser/harness-${info.project.name}.html`, html);
  writeFileSync(
    `output/B357/browser/axe-${info.project.name}.json`,
    JSON.stringify(violations, null, 2),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateToDiary(page, info);
  await openPlanningView(page, info, 'adaptation');
  await page.getByRole('button', { name: 'Обсудить план с консультантом' }).click();
  await expect(panel.getByText('Пока не знаю', { exact: true })).toBeVisible();
  await expect(panel.getByText('Изменение плана сохранено.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Обсудить план с консультантом' })).toBeFocused();
  await expect(
    page.getByText('Согласовать критерий успеха до выхода', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Обсудить план с консультантом' }).click();
  server.deferNext();
  await input.fill('Вопрос по прежнему этапу');
  await panel.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
  await expect.poll(() => server.requests.length).toBe(3);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /Дни 31–60/u }).click();
  await page.getByRole('button', { name: 'Обсудить план с консультантом' }).click();
  await input.fill('Черновик для нового этапа');
  const reply = page.waitForResponse((response) => response.url().includes('/api/v1/coach/turn'));
  server.release();
  await reply;
  await expect(input).toHaveValue('Черновик для нового этапа');
  await expect(panel.getByText(/Контекст:.*Дни 31–60/u)).toBeVisible();
});

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

test('B357 reviews and confirms an existing task change without changing its completion', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const state = fixture({ startDate: '2026-12-20' });
  await mockSignedInCabinet(page, { careerDiary: state });
  await installAdaptationDialogue(page, state, 'edit');
  await navigateToDiary(page, info);
  await openPlanningView(page, info, 'adaptation');
  await page.getByRole('button', { name: 'Запустить план', exact: true }).click();
  const existingTask = page.getByRole('checkbox', { name: /Аудит условий и ожиданий/u });
  await existingTask.click();
  await expect(existingTask).toBeChecked();
  (
    state.workplace!.planning as { adaptationPlan: { tasks: Array<{ description: string }> } }
  ).adaptationPlan.tasks[0]!.description = 'ДлинноеОписание'.repeat(100);
  await page.getByRole('button', { name: 'Обсудить план с консультантом' }).click();
  const panel = page.getByRole(info.project.name === 'mobile-390' ? 'dialog' : 'complementary', {
    name: /Консультант · Карьерный дневник/u,
  });
  const input = panel.getByLabel('Сообщение карьерному консультанту');
  await input.fill('Уточним задачу аудита ожиданий');
  await panel.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
  await expect(panel.getByText('Какой результат от вас ожидают в первый месяц?')).toBeVisible();
  await input.fill('Нужно уточнить критерий результата');
  await panel.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
  const proposal = panel.getByRole('region', { name: 'Предложение задачи адаптации' });
  await expect(proposal.getByText('Текущая задача: Аудит условий и ожиданий')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await proposal.getByRole('button', { name: 'Изменить предложение' }).click();
  await proposal.getByLabel('Название задачи').fill('Согласовать критерий принятия результата');
  await proposal.getByLabel('Срок задачи').fill('2026-12-19');
  await proposal.getByRole('button', { name: 'Сохранить изменение задачи' }).click();
  await expect(proposal.getByRole('alert')).toBeVisible();
  await proposal.getByRole('button', { name: 'Сохранить изменение задачи' }).click();
  await expect(proposal.getByText('Изменение плана сохранено.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('checkbox', { name: /Согласовать критерий принятия результата/u }),
  ).toBeChecked();
  const tasks = (
    state.workplace!.planning as {
      adaptationPlan: { tasks: Array<{ title: string; completed: boolean }> };
    }
  ).adaptationPlan.tasks;
  expect(tasks).toHaveLength(14);
  expect(tasks[0]).toMatchObject({
    title: 'Согласовать критерий принятия результата',
    completed: true,
  });
  await expectNoHorizontalOverflow(page);
  mkdirSync('output/B357/browser', { recursive: true });
  await page.screenshot({ path: `output/B357/browser/task-edited-${info.project.name}.png` });
});

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
  let coachSubject: unknown;
  let coachStage: unknown;
  await mockSignedInCabinet(page, { careerDiary: state });
  await page.route('**/api/v1/coach/turn*', async (route) => {
    const body = route.request().postDataJSON();
    coachPrompt = String(body.content ?? '');
    coachSubject = body.subject;
    coachStage = body.stage;
    await replyToCoach(route);
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if (testInfo.project.name === 'mobile-390') {
    await page
      .getByRole('navigation', { name: 'Разделы' })
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
  const consultant = page.getByRole(
    testInfo.project.name === 'mobile-390' ? 'dialog' : 'complementary',
    { name: /Консультант · Карьерный дневник/u },
  );
  await consultant.getByPlaceholder('Спросите по этому разделу').fill('Как уточнить ожидания?');
  await consultant.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
  await expect(
    page.getByText('По вашему плану стоит сначала согласовать цель и срок с руководителем.'),
  ).toBeVisible();
  expect(coachPrompt).toBe('Как уточнить ожидания?');
  expect(coachStage).toBe('diary');
  expect(coachSubject).toMatchObject({
    kind: 'adaptation',
    id: 'workplace-1',
    adaptationStage: 'prep',
  });
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, 'adaptation-plan-with-task');
  if (testInfo.project.name === 'mobile-390') await page.keyboard.press('Escape');

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
