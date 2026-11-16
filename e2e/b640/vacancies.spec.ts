import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const ROWS = '.b640 table.vt tbody tr.vt-row';

async function openCabinet(page: Page, path: string): Promise<void> {
  await mockSignedInCabinet(page, {
    cabinetB640: true,
    vacancyTotal: 45,
    vacancyFacets: {
      total: 45,
      regions: [],
      remote: 0,
      levels: [],
      roles: [{ role: 'Руководитель продукта', count: 12 }],
      sources: [],
    } as never,
  });
  await page.route('**/api/v1/candidate/vacancy-skips**', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: { data: { clusterId: 'x', reasonId: 'role-family' } } })
      : route.fulfill({ status: 200, json: { data: { ok: true } } }),
  );
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node]').first()).toBeVisible({ timeout: 15_000 });
}

function isMobile(project: string): boolean {
  return project === 'mobile-390';
}

async function openHide(page: Page, mobile: boolean): Promise<void> {
  const row = page.locator(ROWS).first();
  if (mobile) {
    await row.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Не подходит' }).click();
  } else {
    await row.getByRole('button', { name: 'Не подходит' }).click();
  }
}

test.describe('B654: раздел «Вакансии», подборка и сохранённые', () => {
  test('таблица подборки видна, порции по 20, гейты макетов', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    await expect(page.locator('[data-b640-node="s07"]')).toBeVisible();
    await expect(page.locator(ROWS).first()).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(20);
    await expect(page.locator('.vl-foot .btn')).toContainText('Показать ещё 20');
    await page.locator('.vl-foot .btn').click();
    await expect(page.locator(ROWS)).toHaveCount(40);
    await expectGates(page);
  });

  test('фильтр локаций меняет число вакансий, «Сбросить всё» возвращает', async ({
    page,
  }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies');
    const count = page.locator('.vl-count .num');
    await expect(count).toBeVisible();
    const before = Number(await count.innerText());
    await page.getByRole('button', { name: /^Локации/ }).click();
    await expect(page.getByRole('dialog', { name: /Фильтры/ })).toBeVisible();
    await page.locator('.vt-pop .vt-opt input').first().check();
    const after = Number(await count.innerText());
    expect(after).toBeLessThan(before);
    await page.locator('.vt-pop-foot .btn.is-primary').click();
    await expect(page.locator('.vt-pop')).toHaveCount(0);
    await page.locator('.vt-chips').getByRole('button', { name: 'Сбросить всё' }).click();
    await expect(count).toHaveText(String(before));
  });

  test('вкладка «Роли» показывает роли с числом вакансий', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies');
    await page.getByRole('button', { name: /^Все роли/ }).click();
    await expect(
      page.locator('.vt-pop .vt-opt', { hasText: 'Руководитель продукта' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.vt-pop')).toHaveCount(0);
  });

  test('390: лист фильтров — диалог, Esc закрывает', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo.project.name), 'только телефон');
    await openCabinet(page, '/app/vacancies');
    await page.getByRole('button', { name: /^Фильтры · / }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('скрыть с причиной: строка уходит, «Отменить» возвращает', async ({ page }, testInfo) => {
    await openCabinet(page, '/app/vacancies');
    const first = await page.locator(`${ROWS} .vt-toggle`).first().getAttribute('title');
    await openHide(page, isMobile(testInfo.project.name));
    await page.getByRole('radio', { name: 'Зарплата ниже ожиданий' }).check();
    await page.getByRole('button', { name: 'Скрыть', exact: true }).click();
    await expect(page.locator('.va-snack')).toContainText('Скрыто');
    await expect(page.locator(`${ROWS} .vt-toggle`).first()).not.toHaveAttribute(
      'title',
      first ?? '',
    );
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.locator(`${ROWS} .vt-toggle`).first()).toHaveAttribute('title', first ?? '');
  });

  test('«уже откликнулись»: неверная дата — ошибка, верная — метка в строке', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    const row = page.locator(ROWS).first();
    await row.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Уже откликнулись' }).click();
    const date = page.getByLabel('Дата', { exact: true });
    await date.fill('31.13');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Нет такой даты')).toBeVisible();
    await date.fill('05.11');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator(ROWS).first().locator('.va-tag.ok')).toBeVisible();
  });

  test('☆ сохраняет вакансию, она видна в «Сохранённых»', async ({ page }) => {
    await openCabinet(page, '/app/vacancies/saved');
    await expect(page.locator('.st-var-line')).toContainText('Сохранённых вакансий нет');
    await page.getByRole('link', { name: 'Перейти в подборку' }).click();
    await expect(page.locator('[data-b640-node="s07"]')).toBeVisible();
    const star = page.locator(ROWS).first().getByRole('button', { name: 'Сохранить вакансию' });
    await star.click();
    await expect(
      page.locator(ROWS).first().getByRole('button', { name: 'Убрать из сохранённых' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/app/vacancies/saved', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="v06s"]')).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.locator('.vl-count')).toContainText('1 сохранённая вакансия');
    await expectGates(page);
  });

  test('раскрытая строка: сводка и кнопки, одна раскрытая за раз', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    const toggles = page.locator(`${ROWS} .vt-toggle`);
    await toggles.nth(0).click();
    await expect(page.locator('.vt-detail-row .vs')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Откликнуться' })).toBeVisible();
    await toggles.nth(1).click();
    await expect(page.locator('.vt-detail-row .vs')).toHaveCount(1);
  });

  test('снимки подборки и сохранённых для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const width = isMobile(testInfo.project.name) ? 390 : 1440;
    await openCabinet(page, '/app/vacancies');
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      for (const [name, path] of [
        ['vacancies-list', '/app/vacancies'],
        ['vacancies-saved', '/app/vacancies/saved'],
      ] as const) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-b640-node]').first()).toBeVisible();
        await page.screenshot({ path: `.s13-shots/${name}-${width}-${theme}.png` });
      }
    }
  });
});
