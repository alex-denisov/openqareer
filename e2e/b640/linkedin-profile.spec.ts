import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const PROFILE = '/app/profile/linkedin';
const API = '**/api/v1/candidate/b640/linkedin/profile';
const none = { current: null, suggestion: null, copiedAt: null, pastedAt: null };
const LONG = 'Руководитель группы разработки платёжной платформы '.repeat(6).trim();

const initial = {
  headline: {
    current: { text: LONG, source: 'paste', capturedAt: '2026-11-19T10:00:00.000Z' },
    suggestion: {
      text: 'Engineering Manager · платёжная платформа · Go, Kotlin, Kubernetes',
      facts: [
        { id: 'f1', text: 'Группа из 9 человек, 6 из них наняла сама' },
        { id: 'f2', text: 'Релиз раз в 3 дня вместо 2 недель' },
      ],
    },
    copiedAt: null,
    pastedAt: null,
  },
  about: none,
  experience: {
    ...none,
    suggestion: {
      text: 'Финтех Лаб · Руководитель группы разработки\nГруппа из 9 человек.\n\nСфера Платежи · Руководитель группы бэкенда\nВела бэкенд платёжного шлюза.',
      facts: [],
      items: [
        {
          id: 'e1',
          label: 'Финтех Лаб · Руководитель группы разработки',
          text: 'Группа из 9 человек, 6 из них наняла сама. Релиз раз в 3 дня вместо 2 недель.',
          facts: [
            { id: 'd1', text: 'Группа из 9 человек, 6 из них наняла сама' },
            { id: 'b1', text: 'Релиз раз в 3 дня вместо 2 недель' },
          ],
        },
        {
          id: 'e2',
          label: 'Сфера Платежи · Руководитель группы бэкенда',
          text: 'Вела бэкенд платёжного шлюза для интернет-магазинов.',
          facts: [{ id: 'd2', text: 'Вела бэкенд платёжного шлюза для интернет-магазинов' }],
        },
      ],
    },
  },
  skills: {
    ...none,
    suggestion: {
      text: 'Go · Kubernetes · PostgreSQL · Управление командой',
      facts: ['Go', 'Kubernetes', 'PostgreSQL', 'Управление командой'].map((text, i) => ({
        id: `s${i}`,
        text,
      })),
    },
  },
};

async function mock(page: Page, options: { failRead?: boolean; failSave?: boolean } = {}) {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'])
    .catch(() => undefined);
  await page.route('**/api/v1/candidate/connections', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            platform: 'linkedin',
            available: true,
            capabilities: [],
            importsCareerHistory: true,
            status: 'imported',
            importedAt: '2026-11-03T09:40:00.000Z',
          },
        ],
      },
    }),
  );
  await page.route(API, (route) =>
    options.failRead
      ? route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'x' } } })
      : route.fulfill({ json: { data: initial } }),
  );
  await page.route(`${API}/*/current`, (route) =>
    options.failSave
      ? route.fulfill({
          status: 400,
          json: {
            error: {
              code: 'invalid_section_text',
              message: 'Вставьте текст раздела, не длиннее 2600 знаков.',
            },
          },
        })
      : route.fulfill({
          json: {
            data: {
              text: 'Строю команды',
              source: 'paste',
              capturedAt: '2026-11-19T11:00:00.000Z',
            },
          },
        }),
  );
  await page.route(`${API}/*/copied`, (route) =>
    route.fulfill({ json: { data: { copiedAt: '2026-11-19T12:00:00.000Z', pastedAt: null } } }),
  );
  await page.route(`${API}/*/pasted`, (route) =>
    route.fulfill({ json: { data: { copiedAt: null, pastedAt: '2026-11-19T12:30:00.000Z' } } }),
  );
}

const open = async (page: Page) => {
  await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="a03"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.li-sec')).toHaveCount(4);
};
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('B692: профиль LinkedIn по разделам', () => {
  test('«Сейчас» с датой, предложение, факты; без пояснений и «Применить»', async ({ page }) => {
    await mock(page);
    await open(page);
    const headline = page.locator('.li-sec').first();
    await expect(headline.getByText('Сейчас · вставлено вами 19 ноября')).toBeVisible();
    await expect(headline.locator('.li-new')).toContainText('Engineering Manager');
    await expect(headline.locator('.li-facts li')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Применить/ })).toHaveCount(0);
    await expect(page.getByLabel('Вставьте текущий текст раздела')).toHaveCount(3);
    expect(await noOverflow(page)).toBe(true);
    await expectGates(page);
  });

  test('B645: «Опыт» по местам работы, «Навыки» одной строкой, факты свёрнуты', async ({
    page,
  }) => {
    await mock(page);
    await open(page);
    const experience = page.locator('.li-sec').nth(2);
    await expect(experience.locator('.li-item')).toHaveCount(2);
    await expect(experience.locator('.li-item .li-rec-l')).toHaveText([
      'Финтех Лаб · Руководитель группы разработки',
      'Сфера Платежи · Руководитель группы бэкенда',
    ]);
    await expect(
      experience.getByRole('button', {
        name: 'Скопировать: Сфера Платежи · Руководитель группы бэкенда',
      }),
    ).toBeVisible();
    await expect(experience.locator('.li-facts').first()).toBeHidden();
    await experience.getByText('Из каких фактов · 2').click();
    await expect(experience.locator('.li-facts').first()).toBeVisible();
    const skills = page.locator('.li-sec').nth(3);
    await expect(skills.locator('.li-new')).toHaveText(
      'Go · Kubernetes · PostgreSQL · Управление командой',
    );
    await expect(skills.locator('.li-facts')).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    await expectGates(page);
  });

  test('вставка текущего текста сохраняется на месте', async ({ page }) => {
    await mock(page);
    await open(page);
    const about = page.locator('.li-sec').nth(1);
    await about.getByLabel('Вставьте текущий текст раздела').fill('Строю команды');
    await about.getByRole('button', { name: 'Сохранить: О себе' }).click();
    await expect(about.locator('.li-cur')).toHaveText('Строю команды');
    await expect(about.locator('textarea')).toHaveCount(0);
  });

  test('ошибка сохранения под полем, текст остаётся', async ({ page }) => {
    await mock(page, { failSave: true });
    await open(page);
    const about = page.locator('.li-sec').nth(1);
    await about.getByLabel('Вставьте текущий текст раздела').fill('Строю команды');
    await about.getByRole('button', { name: 'Сохранить: О себе' }).click();
    await expect(about.getByRole('alert')).toContainText('не длиннее 2600 знаков');
    await expect(about.locator('textarea')).toHaveValue('Строю команды');
  });

  test('«Скопировать», «Открыть в LinkedIn» и «Вставлено»', async ({ page }) => {
    await mock(page);
    await open(page);
    const copied = page.waitForRequest((request) => request.url().endsWith('/headline/copied'));
    await page.getByRole('button', { name: 'Скопировать: Заголовок' }).click();
    await copied;
    await expect(page.getByText('Скопировано')).toBeVisible();
    const link = page.getByRole('link', { name: 'Открыть в LinkedIn: Заголовок' });
    await expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/me/');
    await expect(link).toHaveAttribute('target', '_blank');
    await page.getByRole('button', { name: 'Вставлено: Заголовок' }).click();
    await expect(page.getByText('Вставлено 19 ноября')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Вставлено: Заголовок' })).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
  });

  test('ошибка чтения: «Повторить» на месте', async ({ page }) => {
    await mock(page, { failRead: true });
    await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить LinkedIn', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
  });

  test('снимки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!process.env.B640_SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    await mock(page);
    await open(page);
    const width = testInfo.project.name === 'desktop-1440' ? 1440 : 390;
    await page.screenshot({ path: `.s13-shots/linkedin-sections-${width}.png`, fullPage: true });
  });
});
