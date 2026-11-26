import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCareer, type CareerOptions } from './careerFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const node = (page: Page, code: string) =>
  page.locator(`[data-b640-node="${code}"]:not([data-b640-state]), [data-b640-state="${code}"]`);

const PLACE = { company: 'Вектор Банк', title: 'Руководитель разработки' };
const NO_GOAL = { state: 'no_goal', ...PLACE };
const READY = {
  state: 'ready',
  ...PLACE,
  goal: { kind: 'promotion', chosenAt: '2026-01-12T09:00:00.000Z' },
  steps: [
    { title: 'План 90 дней закрыт', sub: '1 марта', state: 'done', source: 'из плана 30-60-90' },
    {
      title: 'Вторая команда — платформа',
      sub: 'до 31 декабря',
      state: 'now',
      source: 'цель в дневнике от 3 марта',
    },
    {
      title: 'Бюджет направления',
      sub: 'срок прошёл 30 июня',
      state: 'next',
      source: 'цель в дневнике от 10 января',
    },
  ],
  arguments: [
    {
      id: 'e1',
      text: 'Выпуск релиза: с 14 до 5 дней',
      date: '2026-01-03',
      weekStart: '2025-12-29',
      source: 'Дневник, 3 января',
    },
    {
      id: 'e2',
      text: 'Наняли 2 разработчиков в срок',
      date: '2026-02-20',
      weekStart: '2026-02-16',
      source: 'Дневник, 20 февраля',
    },
  ],
  wage: {
    state: 'ready',
    min: 600_000,
    max: 750_000,
    sampleSize: 31,
    observedAt: '2026-11-10T09:00:00.000Z',
  },
};

const WORKING: CareerOptions = { status: 'working', growth: READY };

test.describe('B670: «Карьера» при «Работаю» (S12)', () => {
  test('цель, шаги с источником, доводы из дневника и вилка роли; гейты', async ({ page }) => {
    await openCareer(page, '/app/career', WORKING);
    const screen = node(page, 's12');
    await expect(
      screen.getByRole('heading', { name: 'Повышение в компании «Вектор Банк»' }),
    ).toBeVisible();
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    await expect(screen).toHaveCSS('padding-top', phone ? '12px' : '16px');
    const steps = screen.locator('.steps > li');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0).locator('.tag')).toHaveText('есть');
    await expect(steps.nth(1).locator('.tag')).toHaveText('в работе');
    await expect(steps.nth(2).locator('.tag')).toHaveText('дальше');
    await expect(
      screen.getByRole('heading', { name: 'Аргументы к разговору о повышении' }),
    ).toBeVisible();
    await expect(screen.getByRole('link', { name: 'Открыть запись' }).first()).toHaveAttribute(
      'href',
      '/app/diary/week?week=2025-12-29',
    );
    await expect(screen.getByText('600–750 тыс. ₽')).toBeVisible();
    await expect(
      screen.getByRole('button', { name: 'Подготовить разговор о повышении' }),
    ).toBeVisible();
    await expectGates(page);
  });

  test('цель не задана — выбор сохраняет цель и открывает шаги', async ({ page }) => {
    const calls = await openCareer(page, '/app/career', {
      status: 'working',
      growth: NO_GOAL,
      growthAfter: READY,
    });
    const pick = node(page, 's12a');
    await expect(pick).toHaveCSS('padding-top', '16px');
    await expect(
      pick.getByRole('heading', { name: 'Что для вас дальше в компании «Вектор Банк»?' }),
    ).toBeVisible();
    await expect(
      pick.getByRole('group', { name: 'Цель на следующий шаг' }).getByRole('button'),
    ).toHaveCount(4);
    await expectGates(page);
    await pick.getByRole('button', { name: 'Повышение в должности' }).click();
    await expect(node(page, 's12').locator('.steps > li')).toHaveCount(3);
    expect(calls.growthGoals).toEqual([{ goal: 'promotion' }]);
  });

  test('S12 по макету: одна кнопка «Подготовить разговор о повышении», смены цели нет', async ({
    page,
  }) => {
    await openCareer(page, '/app/career/growth', WORKING);
    const actions = node(page, 's12').locator('section.lead .actions');
    await expect(actions.locator('.btn')).toHaveText(['Подготовить разговор о повышении']);
    await expect(node(page, 's12').getByRole('button', { name: 'Сменить цель' })).toHaveCount(0);
  });

  test('мало вакансий с зарплатой — «мало данных», не число', async ({ page }) => {
    await openCareer(page, '/app/career', {
      ...WORKING,
      growth: { ...READY, wage: { state: 'thin', sampleSize: 3 } },
    });
    const screen = node(page, 's12');
    await expect(screen.getByText(/мало данных, вакансий с зарплатой 3/u)).toBeVisible();
    await expect(screen.getByText(/тыс\. ₽/u)).toHaveCount(0);
  });

  test('без места работы — ведёт в дневник', async ({ page }) => {
    await openCareer(page, '/app/career', { status: 'working' });
    const screen = node(page, 's12a');
    await expect(screen.getByRole('heading', { name: 'Где вы работаете сейчас?' })).toBeVisible();
    await expect(screen.getByRole('link', { name: 'Открыть дневник' })).toHaveAttribute(
      'href',
      '/app/diary',
    );
  });

  test('снимки: s12-karera-rabotayu, s12a-karera-cel-ne-zadana', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    for (const [name, growth, code] of [
      ['s12-karera-rabotayu', READY, 's12'],
      ['s12a-karera-cel-ne-zadana', NO_GOAL, 's12a'],
    ] as const) {
      await openCareer(page, '/app/career', { status: 'working', growth });
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto('/app/career', { waitUntil: 'domcontentloaded' });
        await expect(node(page, code).locator('.lead-title')).toBeVisible();
        for (const width of desktop ? [1440] : [390]) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});
