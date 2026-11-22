import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { mockAdaptation, type AdaptationCalls } from './adaptationFixture';
import { DUTIES, openStart, STEPS } from './adaptationStartFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

async function openNode(page: Page, path: string, node: string): Promise<AdaptationCalls> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => undefined },
      configurable: true,
    });
  });
  const calls = await mockAdaptation(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`.b640 [data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B663: «Дневник» — адаптация', () => {
  test('d01 → шаг → отметка задачи; первая встреча; карта людей', async ({ page }) => {
    const calls = await openNode(page, '/app/diary/adaptation', 'd01');
    const plan = page.locator('[data-b640-node="d01"]');
    await expect(plan.locator('#pl-title')).toHaveText(
      'День 34 из 90: цель — первый заметный результат',
    );
    await expect(plan.getByText('13 человек · 2 без встречи')).toBeVisible();
    await expectGates(page);
    await plan.getByRole('button', { name: 'Готово: Своя тестовая среда для команды' }).click();
    await expect.poll(() => calls.plans.length).toBe(1);

    await plan.getByRole('link', { name: 'До выхода' }).click();
    const step = page.locator('[data-b640-node="d01a"]');
    await expect(step.getByRole('heading', { name: 'Уточнить у HR' })).toBeVisible();
    await expectGates(page);
    await step.getByLabel('Скрыть резюме на hh.ru').click();
    await expect.poll(() => calls.plans.length).toBe(2);

    await page.goto('/app/diary/adaptation/manager-meeting');
    const meeting = page.locator('[data-b640-node="d01c"]');
    await expect(meeting.locator('.fact')).toHaveCount(6);
    await expectGates(page);

    await page.goto('/app/diary/adaptation/people');
    const people = page.locator('[data-b640-node="d01d"]');
    await expect(people.locator('.tag', { hasText: 'без встречи' })).toHaveCount(2);
    await expectGates(page);
    await people.getByRole('button', { name: 'Назначить встречу' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('С кем').selectOption({ label: 'Руководитель тестовых сред' });
    await dialog.getByLabel('Когда').fill('08.01.2027');
    await dialog.getByRole('button', { name: 'Назначить' }).click();
    await expect
      .poll(() => calls.people.map((call) => call.path))
      .toEqual(['/workplaces/w1/people/p4/meeting']);
  });

  test('d01g–d01i: форма старта, компания из откликов подставляет должность и обязанности', async ({
    page,
  }) => {
    const { created, plans } = await openStart(page);
    const screen = page.locator('[data-b640-node="d01"]');
    await expect(screen.locator('h2.lead-title')).toHaveText(
      'Чтобы собрать план, укажите, куда вы выходите',
    );
    await expectGates(page);
    const company = page.getByRole('combobox', { name: 'Компания' });
    await company.fill('Вект');
    await expect(page.getByRole('option')).toHaveCount(2);
    await company.press('ArrowDown');
    await company.press('Enter');
    await expect(company).toHaveValue('Вектор Банк');
    await expect(page.getByLabel('Должность')).toHaveValue('Руководитель разработки');
    await expect(page.getByLabel('Что от вас ждут')).toHaveValue(DUTIES.join('\n'));
    await page.getByLabel('День выхода').fill('01.12.2026');
    await page.getByRole('button', { name: 'Собрать план' }).click();
    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toEqual({
      company: 'Вектор Банк',
      title: 'Руководитель разработки',
      startDate: '2026-12-01',
      expectations: DUTIES.join('\n'),
    });
    await expect.poll(() => plans.length).toBe(1);
    const saved = plans[0] as { planning: { adaptationPlan: { tasks: { title: string }[] } } };
    expect(saved.planning.adaptationPlan.tasks.map((task) => task.title)).toEqual(
      STEPS.map((step) => step.title),
    );
  });

  test('d01e: письмо копируется и отмечается отправленным; d04: итоги и тексты', async ({
    page,
  }) => {
    const calls = await openNode(page, '/app/diary/adaptation/day-30', 'd01e');
    const check = page.locator('[data-b640-node="d01e"]');
    await expect(check.locator('#d30-title')).toHaveText('Проверка на 30‑й день: один сигнал');
    await expect(check.locator('.fact')).toHaveCount(3);
    await expectGates(page);
    await check.getByRole('button', { name: 'Попросить встречу' }).click();
    await check.getByRole('button', { name: 'Отметить, что отправили' }).click();
    await expect.poll(() => calls.checks.map((call) => call.method)).toEqual(['PUT']);
    await expect(check.getByText(/Письмо отправлено/u)).toBeVisible();

    await page.goto('/app/diary/results');
    const results = page.locator('[data-b640-node="d04"]');
    await expect(results.locator('.row')).toHaveCount(3);
    await expect(results.locator('.tag.part')).toHaveText('отстаёт');
    await expect(results.getByRole('button', { name: 'Скопировать' })).toHaveCount(2);
    await expectGates(page);
  });

  test('снимки адаптации: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(400_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      ['d01', '/app/diary/adaptation'],
      ['d01a', '/app/diary/adaptation/before-start'],
      ['d01b', '/app/diary/adaptation/first-weeks'],
      ['d01c', '/app/diary/adaptation/manager-meeting'],
      ['d01d', '/app/diary/adaptation/people'],
      ['d01f', '/app/diary/adaptation/settling'],
      ['d01e', '/app/diary/adaptation/day-30'],
      ['d04', '/app/diary/results'],
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
          await openNode(page, path, name);
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});
