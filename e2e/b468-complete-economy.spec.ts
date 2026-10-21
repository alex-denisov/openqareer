import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import {
  calculateRelocationScenario,
  relocationScenarioInputSchema,
  type SavedRelocationScenario,
} from '../shared/relocationScenario';

async function openEconomy(page: Page, mobile: boolean) {
  if (mobile) {
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page.getByRole('menuitem', { name: 'Карьера' }).click();
  } else
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьера' })
      .click();
  // B445: на 1440 — строка-раскрытие и кнопка внутри, на 390 — строка-переход.
  const openButton = page.getByRole('button', { name: 'Открыть «Страны и релокация»' });
  await page
    .locator('summary.career-relocation-head, button.career-m-row:has-text("Страны и релокация")')
    .first()
    .click();
  if (await openButton.isVisible()) await openButton.click();
  await page.getByRole('tab', { name: 'Экономика' }).click();
  await page.getByRole('combobox', { name: 'Страна', exact: true }).selectOption('AE');
  await page.getByLabel('Годовая зарплата до налогов').fill('120000');
}
async function fillCost(page: Page, label: string, value: string, once = false) {
  const section = page
    .locator('details.career-relocation-scenario-cost')
    .filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${label}:`) }) });
  await section.locator('summary').click();
  await section.getByRole('spinbutton', { name: `${label}, AED`, exact: true }).fill(value);
  if (!once && label === 'Жильё') await section.getByLabel('Период: Жильё').selectOption('annual');
  await section.locator('summary').click();
}
test('B468 complete household budget saves, retries, reloads, compares and invalidates old output', async ({
  page,
}, info) => {
  test.skip(
    info.project.name === 'mobile-390',
    'На 390 «Экономика» — раскладка по макету без панели сценария; сохранение на 390 проверяет b468-r3-relocation.spec.ts.',
  );
  test.setTimeout(90_000);
  await mockSignedInCabinet(page, { relocation: { consentGranted: true } });
  const saved: SavedRelocationScenario[] = [];
  const keys = new Map<string, SavedRelocationScenario>();
  let loseResponse = true;
  await page.route('**/api/v1/candidate/relocation-scenarios**', async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').at(-1);
    if (request.method() === 'POST') {
      const key = request.headers()['idempotency-key'];
      const input = relocationScenarioInputSchema.parse(request.postDataJSON());
      let item = keys.get(key);
      if (!item) {
        item = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          input,
          result: calculateRelocationScenario(input),
          profileRevision: 0,
        };
        keys.set(key, item);
        saved.unshift(item);
      }
      if (loseResponse) {
        loseResponse = false;
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: 201, json: { data: item } });
      return;
    }
    if (request.method() === 'DELETE') {
      saved.splice(
        saved.findIndex((s) => s.id === id),
        1,
      );
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ json: { data: { items: saved, nextOffset: null } } });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const mobile = info.project.name === 'mobile-390';
  await openEconomy(page, mobile);
  await page.getByLabel('Город расчёта').fill('Дубай');
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  await expect(page.getByText(/Не заполнены расходы:/)).toBeVisible();
  await fillCost(page, 'Жильё', '24000');
  await fillCost(page, 'Коммунальные услуги', '200');
  await fillCost(page, 'Питание', '500');
  await fillCost(page, 'Транспорт', '300');
  await fillCost(page, 'Дополнительная страховка', '0');
  await fillCost(page, 'Образование и дети', '0');
  await fillCost(page, 'Другие обязательства', '0');
  await page.getByText('Разовые расходы и деньги на старт', { exact: true }).click();
  for (const [label, value] of [
    ['Виза и разрешения', '300'],
    ['Переезд', '1000'],
    ['Возвратный депозит', '2000'],
    ['Документы и переводы', '0'],
    ['Дорога', '0'],
    ['Обустройство', '0'],
    ['Средства для подтверждения визы', '0'],
  ])
    await fillCost(page, label, value, true);
  await page.getByRole('button', { name: 'Рассчитать сценарий' }).click();
  const result = page.locator('.career-relocation-scenario-result');
  await expect(result).toContainText(/7\s?000 AED/);
  await fillCost(page, 'Питание', '600');
  await expect(
    page.getByText('Исходные данные изменены. Рассчитайте сценарий заново.'),
  ).toBeVisible();
  await expect(result).toHaveCount(0);
  await fillCost(page, 'Питание', '500');
  await page.getByRole('button', { name: 'Сохранить расчёт в профиль' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить расчёт в профиль' }).click();
  await expect(page.getByText('Расчёт сохранён в профиле.')).toBeVisible();
  expect(saved).toHaveLength(1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openEconomy(page, mobile);
  await page.getByRole('button', { name: 'Открыть: Мой сценарий' }).click();
  await expect(page.getByLabel('Город расчёта')).toHaveValue('Дубай');
  await page.getByRole('checkbox', { name: 'В сравнение: Мой сценарий' }).check();
  await expect(page.getByRole('region', { name: 'Сравнение бюджетов' })).toContainText('Дубай');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('output/B468/browser', { recursive: true });
  const axe = await new AxeBuilder({ page }).include('.career-relocation-scenarios').analyze();
  writeFileSync(
    `output/B468/browser/axe-${info.project.name}.json`,
    JSON.stringify(axe.violations, null, 2),
  );
  expect(axe.violations).toEqual([]);
  await page
    .getByRole('heading', { name: 'Полный сценарий переезда', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `output/B468/browser/economy-${info.project.name}.png`,
    fullPage: false,
  });
  await result.getByRole('heading', { name: 'Итог сценария' }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `output/B468/browser/result-${info.project.name}.png`,
    fullPage: false,
  });
  const styles = await page.evaluate(() =>
    Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n'),
  );
  const html = (await page.content())
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, '');
  writeFileSync(
    `output/B468/browser/harness-${info.project.name}.html`,
    html.replace('</head>', `<style>${styles}</style></head>`),
  );
  await page.getByRole('button', { name: 'Удалить: Мой сценарий' }).click();
  await page.getByRole('button', { name: 'Удалить расчёт', exact: true }).click();
  await expect(page.getByText('Расчётов пока нет.')).toBeVisible();
  await expect(page.getByText('Расчёт удалён. Можно сохранить новую версию.')).toBeVisible();
  await page.setViewportSize({ width: 280, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
