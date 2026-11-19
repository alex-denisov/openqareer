import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const PATH = '/app/profile/contacts';
const TOTAL = 1500;

const PEOPLE = [
  ['Анна Ветрова', 'руководитель найма', 'Гринкод', 'знакомы через Игоря Шаталова'],
  ['Павел Ким', 'CTO', 'Гринкод', 'ответил на ваш комментарий 10.11'],
  ['Елена Сафина', 'HR-партнёр', 'Гринкод', ''],
  ['Дмитрий Лаптев', 'технический рекрутер', 'Вектор Банк', 'работали вместе в «Сфере Платежи», 2018–2021'],
  ['Сергей Белов', 'CTO', 'Арка Холдинг', 'знакомы через Игоря Шаталова'],
] as const;

const contact = (index: number) => {
  const [fullName, roleTitle, companyName, relationship] = PEOPLE[index % PEOPLE.length]!;
  return {
    id: `c${index}`, fullName, roleTitle, companyName, relationship, strength: 'weak', linkedinUrl: null,
    workplaces: [], knowsRecruiterIds: [], source: 'linkedin_import',
    createdAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-10T09:00:00.000Z',
  };
};

type Mode = 'list' | 'empty' | 'error' | 'flaky';

async function mockContacts(page: Page, mode: Mode): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  let failed = false;
  await page.route('**/api/v1/candidate/connection-contacts?*', (route) => {
    if (mode === 'error' || (mode === 'flaky' && !failed)) {
      failed = true;
      return route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'x' } } });
    }
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    const total = mode === 'empty' ? 0 : TOTAL;
    const items = Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, i) => contact(offset + i));
    return route.fulfill({
      json: {
        data: {
          items, total, offset, limit: 100,
          nextOffset: offset + 100 < total ? offset + 100 : null,
          linkedinImport: { state: 'imported', importedAt: '2026-11-10T09:00:00.000Z', importedCount: total },
        },
      },
    });
  });
}

async function open(page: Page, mode: Mode): Promise<void> {
  await mockContacts(page, mode);
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="a02"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('B664: «Контакты» нового кабинета (a02)', () => {
  test('список: заголовок, 20 строк и «Показать ещё»', async ({ page }) => {
    await open(page, 'list');
    await expect(page.locator('#ct-title')).toHaveText('1 500 контактов');
    await expect(page.locator('li.ct-row')).toHaveCount(20);
    await expect(page.locator('.ct-count')).toHaveText('20 из 1 500');
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    await expect(page.locator('li.ct-row')).toHaveCount(40);
    await expectGates(page);
  });

  test('связей нет: одна строка пустого состояния', async ({ page }) => {
    await open(page, 'empty');
    await expect(page.locator('.vl-empty-t')).toHaveText('Связей пока нет');
    await expectGates(page);
  });

  test('ошибка загрузки с «Повторить»', async ({ page }) => {
    await open(page, 'flaky');
    await expect(page.getByRole('alert')).toContainText('Контакты не загрузились');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('li.ct-row')).toHaveCount(20);
  });

  test('снимки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    for (const [name, mode] of [['contacts', 'list'], ['contacts-empty', 'empty'], ['contacts-error', 'error']] as const) {
      await mockContacts(page, mode);
      for (const theme of ['light', 'dark'] as const) {
        await page.goto(PATH, { waitUntil: 'domcontentloaded' });
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(PATH, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-b640-node="a02"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        if (mode === 'list') await expect(page.locator('li.ct-row')).toHaveCount(20);
        for (const width of desktop ? [1440, 1176] : [390]) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({ path: `.s13-shots/${name}-${width}-${theme}.png`, fullPage: true });
        }
      }
    }
  });
});
