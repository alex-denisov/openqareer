import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { mockDiary, type DiaryCalls } from './diaryFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

async function openGoals(page: Page, path: string, node: string): Promise<DiaryCalls> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  const calls = await mockDiary(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`.b640 [data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B662: «Дневник» — цели и показатели', () => {
  test('B768 · d02c: пока примеры под роль готовятся — «Загружаем примеры», затем они без перезагрузки', async ({
    page,
  }) => {
    await mockSignedInCabinet(page, { cabinetB640: true });
    await mockDiary(page);
    const ROOT = '**/api/v1/candidate/career-diary';
    await page.route(ROOT, (route) =>
      route.fulfill({
        json: {
          data: {
            asOf: '2026-11-23',
            platformStartedAt: '2026-10-26',
            primaryWorkplace: { id: 'w1', company: 'Вектор', title: 'Коммерческий директор' },
            summary: {},
          },
        },
      }),
    );
    await page.route(`${ROOT}/goal-cards`, (route) =>
      route.fulfill({ json: { data: { items: [], archived: [] } } }),
    );
    await page.route(`${ROOT}/role-title-ru**`, (route) =>
      route.fulfill({ json: { data: { titleRu: 'Коммерческий директор' } } }),
    );
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await page.route(`${ROOT}/goal-examples`, async (route) => {
      // Модель отвечает долго: держим ответ, пока тест не проверит ожидание.
      await answered;
      await route.fulfill({
        json: {
          data: {
            items: [{ title: 'Выполнить план выручки отдела', measure: 'от плана квартала' }],
          },
        },
      });
    });
    await page.goto('/app/diary/goals', { waitUntil: 'domcontentloaded' });
    const ghost = page.locator('[data-b640-node="d02"] .ghost');
    await expect(ghost.getByRole('status')).toHaveText('Загружаем примеры', { timeout: 15_000 });
    await expect(ghost.locator('.gc-ex')).toHaveCount(0);
    await expect(ghost.locator('.ghost-cap')).toHaveText('Пример для роли «Коммерческий директор»');
    await expectGates(page);
    answer();
    await expect(ghost.locator('.gc-ex strong')).toHaveText(['Выполнить план выручки отдела']);
    await expect(ghost.getByRole('status')).toHaveCount(0);
  });

  test('d02 → d02a: отстающая цель в заголовке, замер, в архив', async ({ page }) => {
    const calls = await openGoals(page, '/app/diary/goals', 'd02');
    const list = page.locator('[data-b640-node="d02"]');
    await expect(list.locator('.lead-title')).toHaveText('Отстаёт «Закрыть 2 вакансии в команду»');
    await expect(list.locator('.dn-goal')).toHaveCount(2);
    await expect(list.getByText('Перевести сборку на общий конвейер')).toBeVisible();
    await expectGates(page);

    await list.locator('.lead').getByRole('link').first().click();
    const card = page.locator('[data-b640-node="d02a"]');
    await expect(card.locator('.gt-h')).toHaveText('Закрыть 2 вакансии в команду');
    await expectGates(page);
    await card.getByRole('button', { name: 'Внести замер' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').first().fill('1');
    await dialog.getByRole('button', { name: 'Сохранить замер' }).click();
    await expect(dialog).toBeHidden();
    expect(calls.measurements).toEqual([expect.objectContaining({ value: 1 })]);

    await card.getByRole('button', { name: 'Ещё действия: цель' }).click();
    await page
      .getByRole('menuitem', { name: 'В архив' })
      .or(page.getByRole('button', { name: 'В архив' }))
      .first()
      .click();
    const reason = page.getByRole('dialog');
    await reason.getByLabel('Почему').fill('Директор перенёс найм');
    await reason.getByRole('button', { name: 'В архив', exact: true }).click();
    await expect.poll(() => calls.archived.length).toBe(1);
  });

  test('d02b: ошибки на месте, затем новая цель открывается карточкой', async ({ page }) => {
    const calls = await openGoals(page, '/app/diary/goals/new', 'd02b');
    const form = page.locator('[data-b640-node="d02b"]');
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    await expect(form).toHaveCSS('padding-top', phone ? '12px' : '8px');
    await expectGates(page);
    await form.getByRole('button', { name: 'Сохранить цель' }).click();
    await expect(form.locator('.va-err').first()).toHaveText('Назовите цель');
    await form.getByLabel('Название').fill('Сократить время ревью');
    await form.getByLabel('Срок').fill('31.03.2099');
    await form.getByLabel('Показатель').first().fill('Время до ревью, часов');
    await form.getByLabel('Сейчас').first().fill('18');
    await form.getByLabel('Цель', { exact: true }).first().fill('4');
    await form.getByRole('button', { name: 'Сохранить цель' }).click();
    await expect(page).toHaveURL(/\/app\/diary\/goals\/goal-new$/u);
    expect(calls.goals).toEqual([expect.objectContaining({ title: 'Сократить время ревью' })]);
  });

  test('B744: d02b — «Сейчас» из записей черновиком, цитата в ⓘ, «Верно»', async ({ page }) => {
    await mockSignedInCabinet(page, { cabinetB640: true });
    await mockDiary(page);
    const asked: unknown[] = [];
    await page.route('**/api/v1/candidate/career-diary/goal-baseline', async (route) => {
      asked.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          data: { value: 18, quote: 'ревью ждут по полтора-два дня', entryDate: '2026-12-30' },
          meta: { requestId: 'r' },
        },
      });
    });
    await page.goto('/app/diary/goals/new', { waitUntil: 'domcontentloaded' });
    const form = page.locator('[data-b640-node="d02b"]');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.getByLabel('Показатель').first().fill('Время до первого ревью, часов');
    await form.getByLabel('Цель', { exact: true }).first().focus();
    const now = form.getByLabel('Сейчас').first();
    await expect(now).toHaveValue('18');
    await expect(now).toHaveClass(/is-draft/u);
    await expect(form.locator('.gb-sugg-t')).toHaveText('18 — из ваших записей');
    expect(asked).toEqual([{ indicator: 'Время до первого ревью, часов' }]);
    await expectGates(page);
    await form.getByRole('button', { name: 'Верно' }).click();
    await expect(form.locator('.gb-sugg')).toHaveCount(0);
    await expect(now).toHaveValue('18');
    await expect(now).not.toHaveClass(/is-draft/u);
  });

  test('B743: d02a «Задачи» — задачи цели из плана, отметка и «+ Задача»', async ({ page }) => {
    await mockSignedInCabinet(page, { cabinetB640: true });
    await mockDiary(page);
    const task = (id: string, title: string, goalId: string | null, dueDate: string) => ({
      id,
      title,
      description: '',
      stage: 'days_1_30',
      category: 'delivery',
      dueDate,
      completed: false,
      source: 'candidate',
    });
    let tasks = [
      task('t1', 'Финальное интервью, решение за 2 дня', 'goal-1', '2027-01-14'),
      task('t2', 'Встреча с командой эксплуатации', null, '2027-01-12'),
    ];
    const links: Record<string, string> = { t1: 'goal-1' };
    const saved: unknown[] = [];
    const workplace = () => ({
      id: 'w1',
      company: 'Вектор Банк',
      title: 'Руководитель разработки',
      startDate: '2026-12-15',
      planning: {
        adaptationPlan: {
          id: 'p1',
          workplaceId: 'w1',
          startDate: '2026-12-15',
          createdAt: '2026-12-15T12:00:00.000Z',
          status: 'active',
          closedAt: null,
          tasks,
        },
      },
    });
    const view = () => ({
      workplaceId: 'w1',
      startDate: '2026-12-15',
      stages: [
        {
          stage: 'days_1_30',
          tasks: tasks.map((item) => ({
            ...item,
            step: null,
            group: null,
            goalId: links[item.id] ?? null,
          })),
        },
      ],
    });
    await page.route(/\/api\/v1\/candidate\/career-diary$/u, (route) =>
      route.fulfill({ json: { data: { primaryWorkplace: { id: 'w1' }, summary: {} } } }),
    );
    await page.route('**/career-diary/workplaces/w1', async (route) => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as {
          planning?: { adaptationPlan?: { tasks: typeof tasks } };
        };
        saved.push(body);
        if (body.planning?.adaptationPlan) tasks = body.planning.adaptationPlan.tasks;
      }
      await route.fulfill({ json: { data: workplace() } });
    });
    await page.route('**/career-diary/workplaces/w1/adaptation', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as {
          tasks: Record<string, { goalId: string }>;
        };
        for (const [id, details] of Object.entries(body.tasks)) links[id] = details.goalId;
      }
      await route.fulfill({ json: { data: view() } });
    });
    await page.goto('/app/diary/goals/goal-1', { waitUntil: 'domcontentloaded' });
    const card = page.locator('[data-b640-node="d02a"]');
    const section = card.locator('section[aria-labelledby="ga-k"]');
    await expect(section.locator('.gt-row label')).toHaveText([
      'Финальное интервью, решение за 2 дня',
    ]);
    await expect(section.locator('.gt-when')).toHaveText(['до 14 янв']);
    await expectGates(page);
    await section.getByLabel('Финальное интервью, решение за 2 дня').check();
    await expect.poll(() => saved.length).toBe(1);
    await expect(section.getByLabel('Финальное интервью, решение за 2 дня')).toBeChecked();

    await section.getByRole('button', { name: 'Задача' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Задача').fill('Созвон с отделом найма о воронке');
    await dialog.getByLabel('Срок').fill('10.01.2027');
    await dialog.getByRole('button', { name: 'Добавить' }).click();
    await expect(dialog).toBeHidden();
    await expect(section.locator('.gt-row label')).toHaveText([
      'Финальное интервью, решение за 2 дня',
      'Созвон с отделом найма о воронке',
    ]);
    await expectGates(page);
  });

  test('B743: d02a — подсказка задачи: строка, «Добавить» кладёт задачу в план, «Пропустить» прячет', async ({
    page,
  }, testInfo) => {
    await mockSignedInCabinet(page, { cabinetB640: true });
    const calls = await mockDiary(page);
    const SUGGESTED = 'Описание второй вакансии в повестку 14 января';
    let tasks: Array<Record<string, unknown>> = [];
    const links: Record<string, string> = {};
    const workplace = () => ({
      id: 'w1',
      company: 'Вектор Банк',
      title: 'Руководитель разработки',
      startDate: '2026-12-15',
      planning: {
        adaptationPlan: {
          id: 'p1',
          workplaceId: 'w1',
          startDate: '2026-12-15',
          createdAt: '2026-12-15T12:00:00.000Z',
          status: 'active',
          closedAt: null,
          tasks,
        },
      },
    });
    const view = () => ({
      workplaceId: 'w1',
      startDate: '2026-12-15',
      stages: [
        {
          stage: 'days_1_30',
          tasks: tasks.map((item) => ({
            ...item,
            step: null,
            group: null,
            goalId: links[item.id as string] ?? null,
          })),
        },
      ],
    });
    await page.route('**/career-diary/goal-cards/*/task-suggestion', (route) =>
      route.fulfill({
        json: { data: { id: 's1', text: SUGGESTED, dueDate: '2027-01-12' } },
      }),
    );
    await page.route(/\/api\/v1\/candidate\/career-diary$/u, (route) =>
      route.fulfill({ json: { data: { primaryWorkplace: { id: 'w1' }, summary: {} } } }),
    );
    await page.route('**/career-diary/workplaces/w1', async (route) => {
      const body = route.request().postDataJSON() as {
        planning?: { adaptationPlan?: { tasks: typeof tasks } };
      } | null;
      if (body?.planning?.adaptationPlan) tasks = body.planning.adaptationPlan.tasks;
      await route.fulfill({ json: { data: workplace() } });
    });
    await page.route('**/career-diary/workplaces/w1/adaptation', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as {
          tasks: Record<string, { goalId: string }>;
        };
        for (const [id, details] of Object.entries(body.tasks)) links[id] = details.goalId;
      }
      await route.fulfill({ json: { data: view() } });
    });
    await page.goto('/app/diary/goals/goal-1', { waitUntil: 'domcontentloaded' });
    const section = page.locator('[data-b640-node="d02a"] section[aria-labelledby="ga-k"]');
    const row = section.locator('li.gt-sugg');
    await expect(row.locator('.gt-sugg-t')).toHaveText(SUGGESTED);
    const add = row.locator('.btn.is-sm');
    const skip = row.locator('.row-act');
    await expect(add).toHaveText('Добавить');
    await expect(skip).toHaveText('Пропустить');
    if (testInfo.project.name === 'mobile-390') {
      for (const control of [add, skip]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await expectGates(page);

    await skip.click();
    await expect(row).toHaveCount(0);
    await expect.poll(() => calls.suggestion).toEqual([{ action: 'skip', id: 's1' }]);
    // Новый заход: мок снова отдаёт подсказку (сервер после «Пропустить» её бы не вернул).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toBeVisible();
    await add.click();
    await expect(row).toHaveCount(0);
    await expect(section.locator('.gt-row label')).toHaveText([SUGGESTED]);
    await expect(section.locator('.gt-when')).toHaveText(['до 12 янв']);
    await expect
      .poll(() => calls.suggestion)
      .toEqual([
        { action: 'skip', id: 's1' },
        { action: 'accept', id: 's1' },
      ]);
    await expectGates(page);
  });

  test('снимки целей: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(300_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      ['d02', '/app/diary/goals'],
      ['d02a', '/app/diary/goals/goal-1'],
      ['d02b', '/app/diary/goals/new'],
    ] as const;
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(
        (value) => window.localStorage.setItem('oq_b640_theme', value),
        theme,
      );
      for (const [name, path] of views) {
        for (const [width, height] of [
          [1440, 900],
          [1176, 900],
          [390, 844],
        ]) {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await page.setViewportSize({ width, height });
          await openGoals(page, path, name);
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});
