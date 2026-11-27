import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCareer, type CareerOptions } from './careerFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const node = (page: Page, code: string) =>
  page.locator(`[data-b640-node="${code}"]:not([data-b640-state]), [data-b640-state="${code}"]`);

const PATH = {
  state: 'ready',
  target: 'Продакт-менеджер',
  forms: { toBecome: 'продакт-менеджеры', genitive: 'продакта', instrumental: 'продактом' },
  sampleSize: 118,
  observedAt: '2026-11-10T09:00:00.000Z',
  requirements: [
    { name: 'Управление командой', vacancies: 60, inProfile: true },
    { name: 'Бюджет', vacancies: 44, inProfile: true },
    { name: 'Исследования', vacancies: 70, inProfile: false },
    { name: 'Метрики', vacancies: 66, inProfile: false },
  ],
  wage: {
    state: 'ready',
    min: 350_000,
    max: 420_000,
    sampleSize: 24,
    observedAt: '2026-11-10T09:00:00.000Z',
  },
  responses: { sent: 3, invited: 0 },
  lowerIncome: null,
};

const CHANGING: CareerOptions = {
  status: 'changing_profession',
  professionPath: PATH,
  income: 440_000,
};

test.describe('B669: «Карьера» при «Меняю профессию» (S11)', () => {
  test('путь в профессию, промежуточная роль, отклики и доход; гейты', async ({ page }) => {
    const calls = await openCareer(page, '/app/career', CHANGING);
    const screen = node(page, 's11');
    await expect(screen.getByRole('heading', { name: 'Путь в продакт-менеджеры' })).toBeVisible();
    await expect(screen.getByText('Что уже есть для продакта')).toBeVisible();
    await expect(screen.getByText('Проверка навыков продакта')).toBeVisible();
    await expect(screen.locator('.s11-resp-t')).toHaveText('Отклики продактом');
    await expect(
      screen.getByText('Через промежуточную роль: Руководитель разработки'),
    ).toBeVisible();
    await expect(screen.getByText('2 из 4 требований')).toBeVisible();
    await expect(screen.getByRole('link', { name: 'Проверить' })).toHaveAttribute(
      'href',
      `/app/career/skills?role=${encodeURIComponent('Продакт-менеджер')}`,
    );
    await expect(screen.getByText(/Вакансии в промежуточной роли · 64/u)).toBeVisible();
    await expect(screen.locator('.s11-resp-n')).toHaveText('Отправлено 3, приглашений 0');
    await expect(screen.locator('.s11-metric')).toHaveText('350–420 тыс. ₽');
    await expect(
      screen.getByText('Это на 5–20 % меньше, чем сейчас: 440 тыс. ₽ на руки'),
    ).toBeVisible();
    await expectGates(page);
    await page.mouse.move(0, 0);
    await screen.getByRole('button', { name: 'Зависит' }).click();
    await expect(screen.getByRole('button', { name: 'Зависит' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(calls.lowerIncome).toEqual([{ answer: 'depends' }]);
  });

  test('без дохода в профиле — вилка без сравнения и вопроса', async ({ page }) => {
    await openCareer(page, '/app/career/change', { ...CHANGING, income: null });
    const screen = node(page, 's11');
    await expect(screen.locator('.s11-metric')).toHaveText('350–420 тыс. ₽');
    await expect(screen.getByText(/чем сейчас/u)).toHaveCount(0);
    await expect(screen.getByRole('group', { name: 'Ответ' })).toHaveCount(0);
  });

  test('мало вакансий с зарплатой — «мало данных», не число', async ({ page }) => {
    await openCareer(page, '/app/career', {
      ...CHANGING,
      professionPath: { ...PATH, wage: { state: 'thin', sampleSize: 3 } },
    });
    const screen = node(page, 's11');
    await expect(screen.getByText('Мало данных: вакансий с зарплатой 3')).toBeVisible();
    await expect(screen.locator('.s11-metric')).toHaveCount(0);
  });

  test('B741: проверка навыков не готова — шаг без кнопки «Проверить»', async ({ page }) => {
    await openCareer(page, '/app/career', {
      ...CHANGING,
      assessmentState: 'insufficient_requirements',
    });
    const screen = node(page, 's11');
    await expect(screen.getByText('Проверка навыков продакта')).toBeVisible();
    await expect(screen.getByText('2 из 4 требований')).toBeVisible();
    await expect(screen.getByRole('link', { name: 'Проверить' })).toHaveCount(0);
  });

  test('профессия без форм в словаре — общие тексты с её названием', async ({ page }) => {
    await openCareer(page, '/app/career', {
      ...CHANGING,
      professionPath: { ...PATH, target: 'Сомелье', forms: null },
    });
    const screen = node(page, 's11');
    await expect(screen.getByRole('heading', { name: 'Путь в профессию «Сомелье»' })).toBeVisible();
    await expect(screen.getByText('Что уже есть для новой профессии')).toBeVisible();
    await expect(screen.getByText('Проверка навыков профессии')).toBeVisible();
    await expect(screen.locator('.s11-resp-t')).toHaveText('Отклики в новой профессии');
  });

  test('профессия не выбрана — ведёт к выбору статуса', async ({ page }) => {
    await openCareer(page, '/app/career', { status: 'changing_profession' });
    const screen = node(page, 's11');
    await expect(
      screen.getByRole('heading', { name: 'Какую профессию вы осваиваете?' }),
    ).toBeVisible();
    await expect(screen.getByRole('link', { name: 'Выбрать профессию' })).toHaveAttribute(
      'href',
      '/app/profile/status?status=changing_profession',
    );
  });

  test('снимки: s11-karera-menyayu', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    await openCareer(page, '/app/career', CHANGING);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto('/app/career', { waitUntil: 'domcontentloaded' });
      await expect(node(page, 's11').locator('.s11-metric')).toBeVisible();
      for (const width of desktop ? [1440, 1176] : [390]) {
        await page.setViewportSize({ width, height: desktop ? 900 : 844 });
        await page.screenshot({
          path: `.s13-shots/s11-karera-menyayu-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  });
});
