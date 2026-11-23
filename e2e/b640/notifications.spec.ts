import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const API = '**/api/v1/candidate';
const PATH = '/app/notifications';
const feed = (page: Page) => page.locator('[data-b640-node="n01b"]');

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const OLD = '2026-11-02T09:00:00.000Z';

function item(id: number, overrides: Record<string, unknown>) {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    kind: 'employer_reply',
    category: 'responses',
    important: false,
    title: 'Есть ответ работодателя',
    company: null,
    role: null,
    eventAt: null,
    createdAt: at(id),
    readAt: null,
    sourceType: 'application',
    sourceId: `app-${id}`,
    ...overrides,
  };
}

const PINNED = [
  item(1, {
    kind: 'delivery_error',
    important: true,
    title: 'Отклик не доставлен · Ладога Банк',
    company: 'Ладога Банк',
    role: 'Руководитель разработки',
  }),
];

const ITEMS = [
  item(2, {
    kind: 'interview_invitation',
    category: 'invitations',
    title: 'Арка Холдинг приглашает на интервью',
    company: 'Арка Холдинг',
    role: 'Руководитель платформы',
    eventAt: '2026-12-12T12:00:00.000Z',
    readAt: at(1),
  }),
  item(3, {
    title: 'Гринкод ответил на отклик',
    company: 'Гринкод',
    role: 'Head of Engineering',
  }),
  item(4, {
    kind: 'new_vacancies_by_role',
    category: 'vacancies',
    title: 'Новые вакансии по вашей роли',
    sourceType: 'matched_vacancy_batch',
    sourceId: 'batch-1',
    createdAt: OLD,
    readAt: OLD,
  }),
];

async function openFeed(page: Page) {
  const calls = { categories: [] as string[], read: [] as string[] };
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route(`${API}/b640/notifications**`, (route) => {
    const url = new URL(route.request().url());
    const category = url.searchParams.get('category') ?? 'all';
    // Колокольчик оболочки читает ленту с limit=1 — это не фильтр экрана.
    if (url.searchParams.get('limit') !== '1') calls.categories.push(category);
    const pick = <T extends { category: string }>(rows: T[]) =>
      category === 'all' ? rows : rows.filter((row) => row.category === category);
    const data = { items: pick(ITEMS), pinned: pick(PINNED), unreadCount: 2, nextCursor: null };
    return route.fulfill({ json: { data } });
  });
  await page.route(`${API}/notifications/*/read`, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    calls.read.push(id);
    return route.fulfill({ json: { data: { id, readAt: OLD } } });
  });
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B671: лента уведомлений', () => {
  test.describe.configure({ timeout: 90_000 });

  test('компания, роль и время в строке; важное сверху с одним действием; гейты', async ({
    page,
  }) => {
    const calls = await openFeed(page);
    const screen = feed(page);
    const pinned = screen.locator('.np-crit-i');
    await expect(pinned).toHaveCount(1, { timeout: 15_000 });
    await expect(pinned).toContainText('Важно');
    // n01b: в «Важно» — «Отклик не дошёл» и «Повторить» с иконкой.
    await expect(pinned).toContainText('Отклик не дошёл · Ладога Банк · Руководитель разработки');
    await expect(pinned.getByRole('link')).toHaveCount(1);
    // n01: при важном непрочитанном счётчик колокольчика — в цвете ошибки (колокольчик шапки 1440).
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      await expect(page.locator('.b640 .bell:visible .dot')).toHaveClass(/is-crit/u);
    }
    const invite = screen.locator('.notif').filter({ hasText: 'Арка Холдинг приглашает' });
    await expect(invite.locator('.notif-s')).toHaveText(
      /^Руководитель платформы · 12 декабря, \d{2}:00 · \d{2}:\d{2}$/u,
    );
    await expect(invite.getByRole('link', { name: 'Ответить' })).toHaveAttribute(
      'href',
      '/app/responses/app-2',
    );
    await expectGates(page);
    const retry = pinned.getByRole('link', { name: 'Повторить' });
    await expect(retry.locator('svg')).toHaveCount(1);
    await retry.click();
    await expect(page).toHaveURL(/\/app\/responses\/app-1\/letter$/u);
    expect(calls.read).toEqual([PINNED[0]!.id]);
  });

  test('фильтры «Приглашения», «Отклики», «Вакансии» — по категории', async ({ page }) => {
    const calls = await openFeed(page);
    const screen = feed(page);
    await expect(screen.locator('.notif')).toHaveCount(3, { timeout: 15_000 });
    await screen.getByRole('button', { name: 'Приглашения' }).click();
    await expect(screen.locator('.notif')).toHaveCount(1);
    await expect(screen.locator('.np-crit-i')).toHaveCount(0);
    await expect(screen.getByRole('button', { name: 'Приглашения' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await screen.getByRole('button', { name: 'Вакансии' }).click();
    await expect(screen.locator('.notif')).toHaveText([/Новые вакансии по вашей роли/u]);
    await screen.getByRole('button', { name: 'Отклики' }).click();
    await expect(screen.locator('.np-crit-i')).toHaveCount(1);
    expect(calls.categories).toEqual(['all', 'invitations', 'vacancies', 'responses']);
  });

  test('снимки: n01b-vse-uvedomleniya', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const width = testInfo.project.name === 'desktop-1440' ? 1440 : 390;
    await openFeed(page);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto(PATH, { waitUntil: 'domcontentloaded' });
      await expect(feed(page).locator('.notif').first()).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: `.s13-shots/n01b-${width}-${theme}.png`, fullPage: true });
    }
  });
});
